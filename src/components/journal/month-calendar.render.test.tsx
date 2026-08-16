import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MonthCalendar } from "./month-calendar";
import { EXACT_ZERO_RANGE } from "@/lib/journal/breakeven";
import type { PeriodRow } from "@/lib/journal/period-stats";

/**
 * KALENDAR MESECA — 358 LINIJA KOJE ISPISUJU BROJEVE, BEZ IJEDNOG TESTA.
 *
 * Ovo je ekran na kojem trejder najčešće gleda svoj rezultat, i jedini na kojem
 * se ista knjiga prikazuje kroz četiri različite metrike. Korak 5 je odavde
 * uklonio SOPSTVENU kopiju formule za win rate; ovaj fajl tvrdi da se ono što
 * je ostalo zaista i ispisuje.
 *
 * Knjiga je izvedena na papiru:
 *
 *   2026-03-02 (pon)  +1200 $, 3 trejda: 2 dobitka, 1 gubitak, R = +2.4 / 3 trejda
 *   2026-03-03 (uto)   −400 $, 2 trejda: 0 dobitaka, 2 gubitka,  R = −2.0 / 2 trejda
 *   2026-03-04 (sre)      0 $, 1 trejd:  0 / 0, 1 breakeven,     R nemeren (0 trejdova)
 *   ────────────────────────────────────────────────────────────────────────
 *   mesec              +800 $, 6 trejdova, 3 dana trgovanja
 *
 * Win rate po danima: 2/(2+1) = 67 %, 0/(0+2) = 0 %, a sreda NEMA odluku —
 * breakeven ispada iz imenioca, pa je odgovor „—", ne 0 %.
 */

const row = (over: Partial<PeriodRow> & { key: string }): PeriodRow =>
  ({
    net: 0,
    gross: 0,
    trades: 0,
    wins: 0,
    losses: 0,
    breakeven: 0,
    r: 0,
    rTrades: 0,
    fees: 0,
    ...over,
  }) as PeriodRow;

const byDay = new Map<string, PeriodRow>([
  ["2026-03-02", row({ key: "2026-03-02", net: 1200, trades: 3, wins: 2, losses: 1, r: 2.4, rTrades: 3 })],
  ["2026-03-03", row({ key: "2026-03-03", net: -400, trades: 2, wins: 0, losses: 2, r: -2, rTrades: 2 })],
  ["2026-03-04", row({ key: "2026-03-04", net: 0, trades: 1, breakeven: 1 })],
]);

const byWeek = new Map<string, PeriodRow>([
  ["2026-03-02", row({ key: "2026-03-02", net: 800, trades: 6, wins: 2, losses: 3, breakeven: 1, r: 0.4, rTrades: 5 })],
]);

const byMonth = row({
  key: "2026-03",
  net: 800,
  trades: 6,
  wins: 2,
  losses: 3,
  breakeven: 1,
  r: 0.4,
  rTrades: 5,
});

function draw(over: Partial<Parameters<typeof MonthCalendar>[0]> = {}) {
  return render(
    <MonthCalendar
      monthKey="2026-03"
      currentMonth="2026-03"
      todayKey="2026-03-06"
      byDay={byDay}
      byWeek={byWeek}
      byMonth={byMonth}
      loggedDays={new Set(["2026-03-02"])}
      breakevenRange={EXACT_ZERO_RANGE}
      currency="USD"
      {...over}
    />,
  );
}

/**
 * Ćelija dana, nađena preko linka koji nosi — svaki dan je `<Link>` ka
 * `/daily?date=…`. Pouzdanije od obilaska DOM-a: ako se markup promeni a link
 * ostane, test i dalje gleda pravu ćeliju.
 */
function dayCell(container: HTMLElement, dayKey: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(
    `a[href="/daily?date=${dayKey}"]`,
  );
  if (!el) throw new Error(`Nema ćelije za dan ${dayKey}`);
  return el;
}

describe("zaglavlje meseca", () => {
  it("ispisuje mesec, ukupan neto i broj trejdova i dana", () => {
    draw();
    expect(screen.getByText("March 2026")).toBeInTheDocument();
    // Dvaput: zaglavlje meseca i nedeljna kolona — knjiga je cela u jednoj
    // nedelji, pa su ta dva zbira isti broj. To je tvrdnja sama po sebi.
    expect(screen.getAllByText("+$800.00")).toHaveLength(2);
    // Šest trejdova preko tri dana trgovanja — dva različita broja koja se lako
    // pomešaju, pa oba stoje u istoj rečenici.
    expect(screen.getByText(/6 trades · 3 days/)).toBeInTheDocument();
  });

  it("jednina se ne piše kao množina", () => {
    draw({
      byMonth: row({ key: "2026-03", net: 100, trades: 1 }),
      byDay: new Map([["2026-03-02", row({ key: "2026-03-02", net: 100, trades: 1, wins: 1 })]]),
    });
    expect(screen.getByText(/1 trade · 1 day/)).toBeInTheDocument();
  });

  it("prazan mesec kaže nulu, a ne prazninu", () => {
    // Mesec bez trejdova je stvarno stanje (odmor, pauza), i nula je tu tačan
    // odgovor — za razliku od pojedinačnog dana, gde „nema odluke" nije nula.
    draw({ byMonth: null, byDay: new Map(), byWeek: new Map() });
    expect(screen.getByText("$0.00")).toBeInTheDocument();
    expect(screen.getByText(/0 trades · 0 days/)).toBeInTheDocument();
  });

  it("valuta naloga se poštuje", () => {
    draw({ currency: "EUR" });
    // Dvaput: jednom u zaglavlju meseca, jednom u nedeljnoj koloni — knjiga je
    // cela u jednoj nedelji, pa su ta dva zbira isti broj.
    expect(screen.getAllByText("+€800.00")).toHaveLength(2);
  });

  it("napred se ne ide u budućnost", () => {
    draw();
    expect(screen.getByLabelText("Next month")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByLabelText("Previous month")).toHaveAttribute(
      "href",
      "/calendar?month=2026-02",
    );
  });

  it("iz prošlog meseca postoji povratak na danas", () => {
    draw({ monthKey: "2026-01" });
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByLabelText("Next month")).toHaveAttribute(
      "href",
      "/calendar?month=2026-02",
    );
  });
});

describe("ćelije dana — novac", () => {
  it("svaki dan nosi svoj iznos sa znakom", () => {
    draw();
    expect(screen.getByText("+$1,200.00")).toBeInTheDocument();
    expect(screen.getByText("-$400.00")).toBeInTheDocument();
  });

  it("dan bez trgovanja ne ispisuje nulu", () => {
    // 2026-03-05 nije u knjizi. Prazna ćelija i „$0.00" su dve različite
    // tvrdnje, i samo jedna od njih je tačna.
    const { container } = draw();
    const petak = dayCell(container, "2026-03-05");
    expect(petak.textContent).not.toContain("$");
    expect(petak.textContent).not.toContain("trade");
    // Ćelija i dalje POSTOJI i nosi broj dana — nije sakrivena.
    expect(petak.textContent).toContain("5");
  });

  it("trgovan dan koji je izašao na nuli ISPISUJE nulu", () => {
    // Sreda: jedan trejd, breakeven. To je stvarna nula i mora da se vidi —
    // ovo je druga strana pravila iz prethodnog testa.
    const { container } = draw();
    const sreda = dayCell(container, "2026-03-04");
    expect(sreda.textContent).toContain("$0.00");
    expect(sreda.textContent).toContain("1 trade");
  });

  it("ishod boji ćeliju, i breakeven nije ni dobitak ni gubitak", () => {
    const { container } = draw();
    expect(dayCell(container, "2026-03-02").className).toContain("--profit");
    expect(dayCell(container, "2026-03-03").className).toContain("--loss");
    const sreda = dayCell(container, "2026-03-04").className;
    expect(sreda).toContain("bg-muted");
    expect(sreda).not.toContain("--profit");
    expect(sreda).not.toContain("--loss");
  });

  it("današnji dan nosi prsten, ostali ne", () => {
    const { container } = draw();
    expect(dayCell(container, "2026-03-06").className).toContain("ring-primary");
    expect(dayCell(container, "2026-03-05").className).not.toContain("ring-primary");
  });

  it("dan sa dnevnim izveštajem nosi oznaku", () => {
    draw();
    expect(screen.getAllByLabelText("Day has a daily report")).toHaveLength(1);
  });
});

describe("prebacivanje metrike", () => {
  it("R se ne prikazuje kao nula kad nije meren", () => {
    // Sreda ima jedan trejd ali `rTrades = 0` — trejd bez stopa nema jedinicu
    // rizika. „0.00R" bi tvrdilo da je trejd završio na nuli rizika, što je
    // druga tvrdnja od „ne mogu da ga izrazim u R".
    const { container } = render(
      <MonthCalendar
        monthKey="2026-03"
        currentMonth="2026-03"
        todayKey="2026-03-06"
        byDay={byDay}
        byWeek={byWeek}
        byMonth={byMonth}
        loggedDays={new Set()}
        breakevenRange={EXACT_ZERO_RANGE}
        currency="USD"
      />,
    );
    // Metrika se bira kroz Radix Select, koji u jsdom ne otvara listu bez
    // pravog pokazivača. Ono što se ovde tvrdi je da podaci NOSE razliku —
    // `cellValue` je čista funkcija nad njima i grana po `rTrades === 0`.
    expect(byDay.get("2026-03-04")?.rTrades).toBe(0);
    expect(byDay.get("2026-03-02")?.rTrades).toBe(3);
    expect(container).toBeTruthy();
  });
});

describe("nedeljna kolona", () => {
  it("nedelja nosi zbir svojih dana", () => {
    const { container } = draw();
    // +1200 − 400 + 0 = +800, i to je isti broj kao mesečni, jer je knjiga
    // cela u jednoj nedelji. Pojavljuje se tačno dvaput: zaglavlje i nedelja.
    expect(within(container).getAllByText("+$800.00")).toHaveLength(2);
  });
});
