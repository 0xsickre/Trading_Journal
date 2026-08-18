import { describe, expect, it } from "vitest";
import { METRICS, getMetric, type MetricContext } from "./reports/metrics";
import { runReport } from "./reports/engine";
import { dimCtx, enrich, mkTrade, metricCtx, type TradeSpec } from "./reports/test-helpers";
import { computeRiskRatios, computeDailyDrawdown, MIN_RATIO_DAYS } from "./risk-ratios";
import { computeStats } from "./analytics";
import { EXACT_ZERO_RANGE } from "./breakeven";
import {
  computeSickreScore,
  PROCESS_ADHERENCE_WEIGHT,
  RATIO_BANDS,
  RECOVERY_BANDS,
  WIN_PCT_TOP_THRESHOLD,
} from "./sickre-score";

/**
 * FORMULE PROTIV SPECIFIKACIJE, NE PROTIV SEBE.
 *
 * `book.fixture.test.ts` dokazuje da kod slaže sa računom na papiru za jednu
 * knjigu. Ovaj fajl pita drugo pitanje: da li kod radi ono što `README.md`
 * §Metrike TVRDI da radi. Razlika je važna — formula može biti interno
 * dosledna a da ne bude ona koja je obećana, i tada je dokumentacija ta koja
 * laže korisniku.
 *
 * Svaka tvrdnja ispod citira rečenicu iz README-a koju zaključava. Ako se
 * formula promeni, test pada i tera da se promeni i README — ili obrnuto.
 *
 * Drugi deo fajla je sistematski: SVAKA metrika iz registra kroz SVAKI
 * degenerisani oblik knjige. Runda 3 je osam nalaza svrstala u „`0` koje glumi
 * *nema podataka*"; jedan po jedan su nalaženi ručno. Ovo je mreža koja tu klasu
 * hvata odjednom.
 */

/** Jedan trejd po danu, sa zadatim neto rezultatom. */
function dailyBook(pnls: number[], startDay = 2): TradeSpec[] {
  return pnls.map((net, i) => {
    const d = String(startDay + i).padStart(2, "0");
    return {
      id: `d${i}`,
      net,
      // 18:00Z pada na isti kalendarski dan u svakoj zoni zapadno od UTC+6,
      // pa izbor zone ne pomera nijedan trejd između dana.
      openedAt: `2026-03-${d}T14:00:00Z`,
      closedAt: `2026-03-${d}T18:00:00Z`,
      r: net / 100,
    };
  });
}

const ctx: MetricContext = { ...metricCtx, range: EXACT_ZERO_RANGE };

// ---------------------------------------------------------------------------
// RACIA — jedini deo specifikacije koji nijedan test do sada nije tvrdio
// ---------------------------------------------------------------------------

describe("Sharpe, Sortino i Calmar — README §Rizik", () => {
  /**
   * Pet dana, izvedeno na papiru:
   *
   *   dan      P&L    kumulativno   vrh    pad
   *   03-02   +100        100       100     0
   *   03-03    -50         50       100   -50
   *   03-04   +200        250       250     0
   *   03-05    -50        200       250   -50
   *   03-06   +100        300       300     0
   *
   *   ukupno            = 300
   *   prosek dnevni     = 300 / 5 = 60
   *   odstupanja        = 40, −110, 140, −110, 40
   *   Σ kvadrata        = 1600 + 12100 + 19600 + 12100 + 1600 = 47 000
   *   σ (populacijska)  = √(47 000 / 5) = √9 400
   *   downside Σ        = 0 + 2500 + 0 + 2500 + 0 = 5 000
   *   downside dev      = √(5 000 / 5) = √1 000
   *   raspon dana       = 03-02 … 03-06 = 5 kalendarskih
   *   periodsPerYear    = 5 × 365 / 5 = 365
   *   max drawdown      = 50  (dva puta po −50, nijedan dublji)
   *   godišnji prinos   = 300 × (365 / 5) = 21 900
   */
  const PNLS = [100, -50, 200, -50, 100];
  const book = enrich(dailyBook(PNLS));
  const points = book.map((e) => ({ day: e.closeDay, at: e.closedAt, pnl: e.pnl }));
  const ratios = computeRiskRatios(points, 50);

  it("meri periodsPerYear iz podataka umesto da pretpostavi 252", () => {
    // README: „periodsPerYear = (dana trgovanja × 365) / kalendarskih dana
    // raspona — izvedeno iz podataka umesto zakucano na 252."
    expect(ratios.days).toBe(5);
    expect(ratios.spanDays).toBe(5);
    expect(ratios.periodsPerYear).toBeCloseTo(365, 10);
    expect(ratios.periodsPerYear).not.toBeCloseTo(252, 0);
  });

  it("Sharpe je prosečan dnevni P&L / σ, anualizovan korenom", () => {
    // README: „prosečan dnevni P&L / σ × √periodsPerYear"
    expect(ratios.meanDaily).toBeCloseTo(60, 10);
    expect(ratios.stdevDaily).toBeCloseTo(Math.sqrt(9400), 10);
    expect(ratios.sharpe).toBeCloseTo((60 / Math.sqrt(9400)) * Math.sqrt(365), 10);
  });

  it("Sortino deli istim brojiocem ali samo silaznim odstupanjem", () => {
    // README: „Isto, ali imenilac broji samo gubitaške dane."
    //
    // Pažnja na tačno značenje: KVADRATI se uzimaju samo od gubitaških dana, ali
    // se dele UKUPNIM brojem dana. Deljenje brojem gubitaških dana nagradilo bi
    // knjigu što retko gubi dvaput — jednom u proseku, pa opet u imeniocu.
    expect(ratios.downsideDeviation).toBeCloseTo(Math.sqrt(1000), 10);
    expect(ratios.sortino).toBeCloseTo((60 / Math.sqrt(1000)) * Math.sqrt(365), 10);
    // Sortino mora biti VEĆI od Sharpe-a ovde: isti brojilac, manji imenilac.
    expect(ratios.sortino!).toBeGreaterThan(ratios.sharpe!);
  });

  it("Calmar je godišnji prinos podeljen drawdown-om", () => {
    // README: „godišnji prinos / max drawdown"
    expect(ratios.calmar).toBeCloseTo((300 * (365 / 5)) / 50, 10);
  });

  it("Sortino je null kad nijedan dan nije bio u minusu — rast nije rizik", () => {
    // README: „`null` kad nijedan dan nije bio u minusu — rast nije rizik."
    const winners = enrich(dailyBook([10, 20, 30, 40, 50]));
    const r = computeRiskRatios(
      winners.map((e) => ({ day: e.closeDay, at: e.closedAt, pnl: e.pnl })),
      0,
    );
    expect(r.downsideDeviation).toBe(0);
    expect(r.sortino).toBeNull();
    // Sharpe preživi: dani se i dalje razlikuju međusobno.
    expect(r.sharpe).not.toBeNull();
    // Calmar ne: bez drawdown-a nema čime da se deli.
    expect(r.calmar).toBeNull();
  });

  it("sva tri racia su null ispod MIN_RATIO_DAYS", () => {
    // README: „Sva tri racija vraćaju `null` ispod `MIN_RATIO_DAYS` (5)."
    expect(MIN_RATIO_DAYS).toBe(5);
    const four = enrich(dailyBook([100, -50, 200, -50]));
    const r = computeRiskRatios(
      four.map((e) => ({ day: e.closeDay, at: e.closedAt, pnl: e.pnl })),
      50,
    );
    expect(r.days).toBe(4);
    expect(r.sharpe).toBeNull();
    expect(r.sortino).toBeNull();
    expect(r.calmar).toBeNull();
  });

  it("σ = 0 daje null Sharpe umesto deljenja nulom", () => {
    // Pet identičnih dana: nema disperzije, pa nema ni odnosa.
    const flat = enrich(dailyBook([25, 25, 25, 25, 25]));
    const r = computeRiskRatios(
      flat.map((e) => ({ day: e.closeDay, at: e.closedAt, pnl: e.pnl })),
      0,
    );
    expect(r.stdevDaily).toBe(0);
    expect(r.sharpe).toBeNull();
  });
});

describe("Avg daily DD — README §Rizik", () => {
  it("dan bez pada ulazi u imenilac kao 0", () => {
    // README: „Prosečan pad unutar dana, od dnevnog vrha. Dan bez pada ulazi kao 0."
    //
    // Na papiru, jedan trejd po danu: dan počinje na vrhu 0, pa gubitaški dan
    // pada za svoj pun iznos a dobitnički ne pada uopšte.
    //
    //   +100 → 0 ; −50 → −50 ; +200 → 0 ; −50 → −50 ; +100 → 0
    //   zbir = −100 ; kroz 5 dana = −20
    const book = enrich(dailyBook([100, -50, 200, -50, 100]));
    const dd = computeDailyDrawdown(
      book.map((e) => ({ day: e.closeDay, at: e.closedAt, pnl: e.pnl })),
    );
    expect(dd.days).toBe(5);
    expect(dd.avgMoney).toBeCloseTo(-20, 10);
    expect(dd.worstMoney).toBeCloseTo(-50, 10);

    // Prosek SAMO nad gubitaškim danima bio bi −50 — druga brojka i drugo
    // pitanje. Ovo je provera da imenilac zaista drži svih pet.
    expect(dd.avgMoney).not.toBeCloseTo(-50, 10);
  });
});

// ---------------------------------------------------------------------------
// UGOVORI IZ README-a KOJI SE LAKO IZGUBE
// ---------------------------------------------------------------------------

describe("Profit factor i expectancy — README §Novac i brojanje", () => {
  it("profit factor je Infinity bez gubitka, null kad nema šta da se deli", () => {
    // README: „`Infinity` kad nema gubitka — stvarni maksimum, ne nedostatak
    // podataka. `null` samo kad nema šta da se deli."
    const allWin = computeStats(dailyBook([10, 20, 30]).map(mkTrade), "net", EXACT_ZERO_RANGE);
    expect(allWin.profitFactor).toBe(Infinity);

    const empty = computeStats([], "net", EXACT_ZERO_RANGE);
    expect(empty.profitFactor).toBeNull();

    // Sve breakeven: ima trejdova, ali ni profita ni gubitka za deljenje.
    const flat = computeStats(dailyBook([0, 0, 0]).map(mkTrade), "net", EXACT_ZERO_RANGE);
    expect(flat.profitFactor).toBeNull();
  });

  it("breakeven trejdovi su van imenioca win rate-a", () => {
    // README: „**Breakeven trejdovi su van imenioca**"
    //
    // Dva dobitka, jedan gubitak, tri breakeven → 2/3 = 66.7 %, ne 2/6 = 33.3 %.
    const s = computeStats(
      dailyBook([100, 100, -100, 0, 0, 0]).map(mkTrade),
      "net",
      EXACT_ZERO_RANGE,
    );
    expect(s.wins).toBe(2);
    expect(s.losses).toBe(1);
    expect(s.breakeven).toBe(3);
    expect(s.winRate).toBeCloseTo((2 / 3) * 100, 10);
    expect(s.winRate).not.toBeCloseTo((2 / 6) * 100, 10);
  });

  it("expectancy se računa samo nad R populacijom", () => {
    // README: „Računa se samo nad R populacijom — samo trejd sa stopom ima R."
    //
    // Dva trejda sa R, četiri bez. Expectancy sme da vidi samo prva dva, pa mora
    // ostati isti kad se ona četiri dodaju.
    const withR: TradeSpec[] = [
      { id: "a", net: 200, r: 2, closedAt: "2026-03-02T18:00:00Z" },
      { id: "b", net: -100, r: -1, closedAt: "2026-03-03T18:00:00Z" },
    ];
    const withoutR: TradeSpec[] = [
      { id: "c", net: 500, r: null, closedAt: "2026-03-04T18:00:00Z" },
      { id: "d", net: -500, r: null, closedAt: "2026-03-05T18:00:00Z" },
      { id: "e", net: 700, r: null, closedAt: "2026-03-06T18:00:00Z" },
      { id: "f", net: -700, r: null, closedAt: "2026-03-09T18:00:00Z" },
    ];
    const only = computeStats(withR.map(mkTrade), "net", EXACT_ZERO_RANGE);
    const mixed = computeStats([...withR, ...withoutR].map(mkTrade), "net", EXACT_ZERO_RANGE);

    // Na papiru: R populacija je 1 dobitak (2R) i 1 gubitak (−1R).
    // rWinRate = 1/2 ; expectancy = 0.5 × 2 + 0.5 × (−1) = 0.5
    expect(only.expectancy).toBeCloseTo(0.5, 10);
    expect(mixed.expectancy).toBeCloseTo(0.5, 10);

    // Kontrola da su ta četiri stvarno ušla u knjigu, samo ne u expectancy.
    expect(mixed.count).toBe(6);
    expect(only.count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// SISTEMSKI DEO — svaka metrika kroz svaki degenerisani oblik
// ---------------------------------------------------------------------------

/**
 * Oblici koje knjiga može imati. Isti skup koji `book.fixture.test.ts` koristi
 * za šačicu brojki, ovde protiv SVIH trideset metrika odjednom.
 */
const SHAPES: Record<string, TradeSpec[]> = {
  prazna: [],
  "jedan trejd": dailyBook([100]).slice(0, 1),
  "sve dobitnici": dailyBook([100, 200, 300, 50, 150]),
  "sve gubitnici": dailyBook([-100, -200, -300, -50, -150]),
  "sve breakeven": dailyBook([0, 0, 0, 0, 0]),
  "bez R populacije": dailyBook([100, -50, 200]).map((t) => ({ ...t, r: null })),
  "jedan dan, vise trejdova": [
    { id: "s1", net: 100, closedAt: "2026-03-02T15:00:00Z", r: 1 },
    { id: "s2", net: -50, closedAt: "2026-03-02T16:00:00Z", r: -0.5 },
    { id: "s3", net: 25, closedAt: "2026-03-02T17:00:00Z", r: 0.25 },
  ],
};

describe("svaka metrika kroz svaki oblik knjige", () => {
  it("registar ima trideset tri metrike i nijedan dvostruk ključ", () => {
    // Broj je zakucan namerno: petlja ispod vrti SVAKU metriku kroz svaki
    // oblik knjige, pa metrika dodata bez razmišljanja tiho dobije dvadeset
    // jednu novu tvrdnju i nijedan pogled. Ovaj red je taj pogled — pada kad
    // se registar promeni i traži da neko potvrdi da je promena namerna.
    //
    // 30 → 33 kad su `winner_target_attainment`, `avg_entry_slip` i
    // `total_slip_r` došli sa dashboard-a, gde su prestali da se prikazuju.
    expect(METRICS).toHaveLength(33);
    expect(new Set(METRICS.map((m) => m.key)).size).toBe(33);
  });

  for (const [shapeName, specs] of Object.entries(SHAPES)) {
    const group = enrich(specs);

    for (const metric of METRICS) {
      it(`${metric.key} · ${shapeName}`, () => {
        const value = metric.compute(group, ctx, undefined);

        // NaN se probije kroz svako sabiranje i formatira se kao „NaN" na
        // ekranu. Nijedna metrika ne sme da ga proizvede ni na jednom obliku.
        if (typeof value === "number") {
          expect(Number.isNaN(value), `${metric.key} vratio NaN`).toBe(false);
        }

        // Dozvoljeni oblici su broj (uključujući Infinity) i null. `undefined`
        // bi značilo da je grana zaboravljena, a ne da odgovora nema.
        expect(
          value === null || typeof value === "number",
          `${metric.key} vratio ${typeof value}`,
        ).toBe(true);
      });
    }
  }
});

/**
 * NULA NASPRAM NULL-a — gde je granica zaista povučena.
 *
 * Prva verzija ovog fajla je tvrdila da SVAKA metrika mora vratiti `null` na
 * praznoj knjizi. Test je pao na deset metrika, i provera je pokazala da je
 * pogrešna bila tvrdnja, ne kod.
 *
 * `computeStats` namerno vraća 0 za `winRate`, `avgR`, `best`, `worst` i ostale
 * agregate nad praznom populacijom, i uz njih nosi `count`, `wins`, `losses` i
 * `expectancySample` da pozivalac zna koliko je uzorak. Odluku „prikaži —"
 * donosi PREZENTACIONI sloj; to je tačno ono što su popravke `W1` i `W2` uradile
 * u `dashboard.tsx` i `metrics-panel.tsx`. Pretvoriti biblioteku u null-ove
 * značilo bi razgraditi tu popravku i preneti odluku na mesto koje ne zna
 * kontekst.
 *
 * Za izveštaje je pitanje ionako nedostižno: `runReport` gradi grupe iz trejdova
 * (`arr.push(t)`), pa grupa sa nula trejdova ne može ni da postoji. Donji test
 * to tvrdi izričito — jer upravo ta nedostižnost je ono što čini nule bezopasnim.
 *
 * Ono što ovde ostaje kao prava tvrdnja jeste uži skup: metrike koje README
 * OBEĆAVA kao `null`, i koje bi kao 0 značile nešto neistinito.
 */
describe("nula naspram null-a", () => {
  it("izveštaj ne može da napravi praznu grupu", () => {
    const result = runReport({
      trades: enrich(SHAPES["sve dobitnici"]),
      dimension: "direction",
      metricKeys: METRICS.map((m) => m.key),
      dimensionContext: dimCtx(),
      metricContext: ctx,
      minSample: 1,
    });
    const rows = result!.rows;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.n, "grupa bez trejdova ne sme da postoji").toBeGreaterThan(0);
    }
  });

  it("metrike sa obećanim null-om ne vraćaju 0 kad populacija ne postoji", () => {
    // Svaka od ovih bi kao 0 tvrdila nešto neistinito: „profit factor 0" znači
    // da knjiga ne zarađuje, „Sharpe 0" da nema prinosa, „target attainment 0 %"
    // da nijedan cilj nije dostignut. Nedostatak podataka nije nalaz.
    const promisedNull = [
      "profit_factor",
      "recovery_factor",
      "sharpe",
      "sortino",
      "calmar",
      "avg_hold",
      "cost_pct_of_gross",
      "avg_win_loss",
      "avg_planned_r",
      "delta_r",
      "avg_mae_r",
      "target_attainment",
      "follow_rate",
    ];
    const empty = enrich([]);
    for (const key of promisedNull) {
      const m = getMetric(key)!;
      expect(m, `${key} nije u registru`).toBeDefined();
      expect(
        m.compute(empty, ctx, undefined),
        `${key} mora biti null bez populacije`,
      ).toBeNull();
    }
  });

  it("zbirovi su pošteno 0 nad praznim skupom", () => {
    // Suprotna strana iste granice: nula trejdova JESTE zaradila nula i platila
    // nula provizija. Ovde bi null bio pogrešan.
    const empty = enrich([]);
    for (const key of ["net_pnl", "gross_pnl", "total_r", "total_fees", "total_swap", "trade_count"]) {
      expect(getMetric(key)!.compute(empty, ctx, undefined), key).toBe(0);
    }
  });
});

describe("getMetric", () => {
  it("nalazi svaki ključ iz registra i odbija nepoznat", () => {
    for (const m of METRICS) expect(getMetric(m.key)).toBe(m);
    expect(getMetric("nema_ovakve")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// SICKRE SCORE — tablice i ponderi kakvi u README-u pišu
// ---------------------------------------------------------------------------

describe("Sickre Score — README §Sickre Score", () => {
  it("ponderi su tačno oni iz tabele u README-u", () => {
    // README: „Profit factor 25 | Avg win/loss 20 | Max drawdown 20 | Win % 15
    // | Recovery factor 10 | Consistency 10", i sedma komponenta sa 15.
    //
    // Ponder je jedini broj u skoru koji ne pada ni na jedan drugi test: greška
    // ovde pomera SVAKI skor, a nijedna pojedinačna komponenta ne bi prijavila
    // ništa. Zato se čita iz onoga što skor zaista vraća, ne iz konstante.
    const full = computeSickreScore({
      profitFactor: 3,
      avgWinLossRatio: 3,
      maxDrawdownPctOfPeakPnl: 0,
      winPct: 100,
      recoveryFactor: 5,
      consistencyScore: 100,
      processAdherencePct: 100,
      sample: { trades: 100, decided: 100 },
    });
    const w = Object.fromEntries(full.components.map((c) => [c.key, c.weight]));
    expect(w).toEqual({
      profitFactor: 25,
      avgWinLoss: 20,
      maxDrawdown: 20,
      winPct: 15,
      recovery: 10,
      consistency: 10,
      process: PROCESS_ADHERENCE_WEIGHT,
    });
    expect(PROCESS_ADHERENCE_WEIGHT).toBe(15);

    // Šest osnovnih pondera mora da da tačno 100; sedmi se dodaje preko toga i
    // skor se renormalizuje po pokrivenosti.
    const base = 25 + 20 + 20 + 15 + 10 + 10;
    expect(base).toBe(100);
  });

  it("tablica racia počinje na 1.8 i završava na 2.6, kao što README kaže", () => {
    // README: „Tablica bandova, 1.8 → 2.6 mapira na 20 → 100"
    const floors = RATIO_BANDS.map((b) => b.min).filter((m) => Number.isFinite(m));
    expect(Math.min(...floors)).toBe(1.8);
    expect(Math.max(...floors)).toBe(2.6);
    // Ispod najniže granice se pada na 20, ne na 0 — 20 je pod, ne odsustvo.
    expect(RATIO_BANDS.at(-1)!.scoreMin).toBe(20);
    expect(RATIO_BANDS[0].scoreMax).toBe(100);
  });

  it("tablica recovery-ja ide od 1.0 do 3.5", () => {
    // README: „Svoja tablica, 1.0 → 3.5"
    const floors = RECOVERY_BANDS.map((b) => b.min).filter((m) => Number.isFinite(m));
    expect(Math.min(...floors)).toBe(1.0);
    expect(Math.max(...floors)).toBe(3.5);
    // Recovery ispod 1.0 JESTE nula: knjiga koja nije vratila svoj drawdown
    // nije se oporavila. Za razliku od racia, ovde nula nije odsustvo podatka.
    expect(RECOVERY_BANDS.at(-1)!.scoreMax).toBe(0);
  });

  it("win % se skalira na 60 i ograničava odozgo", () => {
    // README: „`win% / 60 × 100`, sa gornjim ograničenjem"
    expect(WIN_PCT_TOP_THRESHOLD).toBe(60);
    const at = (winPct: number) =>
      computeSickreScore({
        profitFactor: 2, avgWinLossRatio: 2, maxDrawdownPctOfPeakPnl: 10,
        winPct, recoveryFactor: 2, consistencyScore: 50,
        sample: { trades: 100, decided: 100 },
      }).components.find((c) => c.key === "winPct")!.score;

    expect(at(30)).toBeCloseTo((30 / 60) * 100, 6);
    expect(at(60)).toBeCloseTo(100, 6);
    // Iznad praga ostaje 100 — bez ograničenja bi 90 % dalo 150.
    expect(at(90)).toBeCloseTo(100, 6);
  });

  it("max drawdown je 100 − procenat, na osnovi vrha P&L-a", () => {
    // README: „`100 − maxPctOfPeakPnl`", i izričito: ta osnova se NIKAD ne
    // prikazuje, postoji samo da skor ostane uporediv sa TradeZella-om.
    const at = (pct: number | null) =>
      computeSickreScore({
        profitFactor: 2, avgWinLossRatio: 2, maxDrawdownPctOfPeakPnl: pct,
        winPct: 50, recoveryFactor: 2, consistencyScore: 50,
        sample: { trades: 100, decided: 100 },
      }).components.find((c) => c.key === "maxDrawdown");

    expect(at(40)!.score).toBeCloseTo(60, 6);
    expect(at(0)!.score).toBeCloseTo(100, 6);
    // `null` znači „kriva nikad nije pala sa vrha iznad nule" — komponenta se
    // tada NE broji, umesto da 100 − 0 oceni prazan nalog kao savršen. To je
    // nalaz S1, i ovo je njegova ograda.
    expect(at(null)!.counted).toBe(false);
  });
});
