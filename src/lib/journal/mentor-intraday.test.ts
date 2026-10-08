import { describe, expect, it } from "vitest";
import { buildMentorPack } from "./mentor-export";
import { dimensionTable, ruleLabel, rulesSection, SMALL_SAMPLE, sr } from "./mentor-intraday";
import { enrichTrades } from "./enriched-trade";
import { toRealized } from "./analytics";
import { evaluateTopstep } from "./topstep";
import type { PositionStat, TradeRow } from "./types";
import type { Insight } from "./insights/types";
import type { SessionBrief } from "./session-brief";
import type { TrackerRule } from "./tracker-types";
import type { DayCompliance } from "./tracker/compliance";
import type { FieldDef } from "./field-def-types";

// 29.09.2026 is US summer time: 09:30 ET = 13:30 UTC = 15:30 in Belgrade.
function trade(no: number, openedAt: string, closedAt: string, net: number, size = 1): TradeRow {
  const id = `00000000-0000-0000-0000-00000000000${no}`;
  const stats = {
    position_id: id,
    avg_entry: 100,
    avg_exit: 100,
    entry_qty: size,
    exit_qty: size,
    gross_pl: net,
    net_pl: net,
    total_fees: 0,
    realized_r: net / 100,
    realized_r_net: null,
    opened_at: openedAt,
    closed_at: closedAt,
    duration_seconds: (Date.parse(closedAt) - Date.parse(openedAt)) / 1000,
    point_value: 1,
    tick_size: null,
    quote_currency: "USD",
    account_currency: "USD",
    fx_rate: 1,
    fx_rate_source: "same_currency",
    money_overridden: false,
    point_value_source: "snapshot",
  } as PositionStat;
  return {
    id,
    account_id: "ts",
    trade_no: no,
    status: "closed",
    source: "import",
    needs_review: false,
    created_at: openedAt,
    instrument: "MNQ",
    direction: "Long",
    position_size: size,
    stats,
    tv_images: {},
  } as unknown as TradeRow;
}

const book = [
  trade(1, "2026-09-29T13:40:00Z", "2026-09-29T13:45:00Z", -100),
  trade(2, "2026-09-29T13:50:00Z", "2026-09-29T13:55:00Z", -100),
  // After two losses in a row, inside the CPI window, with double size.
  trade(3, "2026-09-29T14:00:00Z", "2026-09-29T14:10:00Z", -200, 2),
  trade(4, "2026-09-30T14:30:00Z", "2026-09-30T14:50:00Z", 300),
];

const brief: SessionBrief = {
  tradingDay: "2026-09-29",
  flatBy: null,
  dayNote: null,
  redWindows: [{ from: "2026-09-29T13:58:00Z", to: "2026-09-29T14:05:00Z", title: "CPI", impact: "visok" }],
  droppedWindows: 0,
  ranges: {},
  sourceUrl: null,
};

const rule: TrackerRule = {
  id: "r-stop",
  text: "Bez ulaza posle dnevnog cilja",
  stage: "trade",
  active_days: [1, 2, 3, 4, 5],
  auto_key: "no_entry_after_daily_target",
  config: {},
  is_mandatory: true,
  sort_order: 0,
  created_at: "2026-09-01T00:00:00Z",
  deleted_at: null,
};

const compliance: DayCompliance[] = [
  { date: "2026-09-29", applicable: 2, satisfied: 1, pct: 50, status: "broken", missedRuleIds: ["r-stop"], unansweredRuleIds: [] },
  { date: "2026-09-30", applicable: 2, satisfied: 2, pct: 100, status: "compliant", missedRuleIds: [], unansweredRuleIds: [] },
];

const tiltInsight: Insight = {
  ruleId: "revenge_trade",
  level: "trade",
  severity: "critical",
  title: "Revenge entry",
  detail: "x",
  subjectId: book[2].id,
};

const topstep = evaluateTopstep(
  { enabled: true, plan: "50K", startingBalance: 50_000, payoutAt: null, resetAt: null, personalDll: null, dailyTarget: null },
  toRealized(book).map((r) => ({ closedAt: r.closedAt, net: r.net })),
  "2026-09-30T20:00:00Z",
);

const pack = () =>
  buildMentorPack(book, {
    tzOf: () => "UTC",
    displayTz: "Europe/Belgrade",
    briefs: [brief],
    trackerRules: [rule],
    compliance,
    insights: { insights: [tiltInsight], skipped: [] },
    reports: [{ report_date: "2026-09-29", mental_temp: 4, no_trade_day: false }],
    topstep:
      topstep.status === "off"
        ? []
        : [{ accountName: "Topstep 50K", plan: "50K", startingBalance: 50_000, riskRulePct: 8, result: topstep }],
  });

describe("mentor pack for a day trader (F5.6)", () => {
  it("tells the model it is reading an intraday Topstep book, and how", () => {
    const md = pack();
    expect(md).toContain("mentor za intraday trgovanje CME fjučersima");
    expect(md).toContain("Vremena: Europe/Belgrade (tvoja zona); sesije po ET (New York)");
    expect(md).toContain("**DLL** (Daily Loss Limit)");
    expect(md).toContain(`manje od ${SMALL_SAMPLE} trejdova`);
  });

  it("states the Topstep account against the firm's limits", () => {
    const md = pack();
    expect(md).toContain("## Topstep nalog — stanje i pravila firme");
    expect(md).toContain("### Topstep 50K — 50K · status: active");
    expect(md).toContain("| DLL | 1000.00 USD dnevno;");
    expect(md).toContain("8% prostora do MLL-a");
  });

  it("lists the trader's rules and the ones broken most", () => {
    const md = pack();
    expect(md).toContain("- Bez ulaza posle dnevnog cilja (trgovanje, obavezno · automatski: `no_entry_after_daily_target` · Mon, Tue, Wed, Thu, Fri)");
    expect(md).toContain("prosek **75%** na 2 dana; 1 dan bez ijednog prekršaja");
    expect(md).toContain("- Bez ulaza posle dnevnog cilja — 1 dan");
  });

  it("gives one row per trading day with what a day trader is judged on", () => {
    const md = pack();
    expect(md).toContain("## Dnevni pregled (2 dana u periodu, 2 sa trejdovima)");
    // 3 trades, all lost, first at 09:40 ET, a run of 3, two contracts at
    // most, half the rules kept, the mental note. No count of trades after losses.
    expect(md).toContain(
      "| 2026-09-29 | 3 | 0/3/0 | -400.00 | -4.00R | 09:40 | 3 | 2 | 4/5 | — | 50% (Bez ulaza posle dnevnog cilja) | 1 ulaz u crvenom prozoru |",
    );
  });

  it("breaks the book down by session window, with small groups marked", () => {
    const md = pack();
    expect(md).toContain("### Sesijski prozor (ET)");
    expect(md).toContain("| Open 09:30–10:00 | 2 ⚠ |");
    expect(md).toContain("### Stanje pre ulaza (gubici zaredom tog dana)");
    expect(md).toContain("| After 2+ losses | 1 ⚠ |");
  });

  it("tells each trade's intraday story, oldest first", () => {
    const md = pack();
    expect(md).toContain(
      "- **Vreme:** ulaz 29.09. 16:00:00 · izlaz 16:10:00 · (Europe/Belgrade) = 10:00 ET · Morning 10:00–11:30 · 30 min posle otvaranja",
    );
    expect(md).toContain("3. trejd dana · pre ulaza 2 gubitka zaredom · plan pre ulaza · trajanje 10m · 2 ugovora");
    expect(md).toContain("- **Ulaz u crvenom prozoru:** CPI (visok) 09:58–10:05 ET");
    expect(md).toContain("- **Zapažanja na ovom trejdu:** Revenge entry");
    expect(md.indexOf("### Trade #1")).toBeLessThan(md.indexOf("### Trade #4"));
    // The heading's close time is on the trader's clock, not UTC.
    expect(md).toContain("### Trade #3 — MNQ Long · 2026-09-29 16:10");
  });

  it("stays the plain pack when no day rule is given", () => {
    const md = buildMentorPack(book);
    expect(md).not.toContain("Dnevni pregled");
    expect(md).not.toContain("Sesijski prozor");
    expect(md).toContain("ICT trading mentor");
  });
});

describe("dimensionTable", () => {
  it("keeps the dimension's own order and says when there is nothing", () => {
    const enriched = enrichTrades(toRealized(book), { tzOf: () => "UTC" });
    const table = dimensionTable(enriched, "trade_no_in_day", { from: 0, to: 0 });
    const rows = table.split("\n").slice(2).map((l) => l.split("|")[1].trim());
    expect(rows).toEqual(["1st", "2nd", "3rd"]);
    expect(dimensionTable([], "session_window", { from: 0, to: 0 })).toBe("_nema podataka_");
    expect(dimensionTable(enriched, "no_such_dimension", { from: 0, to: 0 })).toBe("_nema podataka_");
  });
});

describe("sr — Serbian plural", () => {
  it("picks one, few or many the way the language does", () => {
    const g = (n: number) => `${n} ${sr(n, "gubitak", "gubitka", "gubitaka")}`;
    expect([1, 2, 4, 5, 11, 12, 21, 22, 25].map(g)).toEqual([
      "1 gubitak",
      "2 gubitka",
      "4 gubitka",
      "5 gubitaka",
      "11 gubitaka",
      "12 gubitaka",
      "21 gubitak",
      "22 gubitka",
      "25 gubitaka",
    ]);
  });
});

describe("mentor pack details found by the mock book (30.09.2026)", () => {
  const missed = (no: number, outcome: string | null, r: number | null): TradeRow =>
    ({
      id: `00000000-0000-0000-0000-0000000001${no}`,
      trade_no: no,
      status: "missed",
      source: "manual",
      needs_review: false,
      created_at: "2026-09-29T12:00:00Z",
      missed_at: "2026-09-29T14:00:00Z",
      instrument: "MNQ",
      direction: "Long",
      miss_reason: "Oklevao",
      missed_outcome: outcome,
      missed_r: r,
      tv_images: {},
    }) as unknown as TradeRow;

  it("gives each missed setup its R2 outcome and the time on the trader's clock", () => {
    const md = buildMentorPack([...book, missed(11, "target", 3), missed(12, "no_entry", 0), missed(13, null, null)], {
      displayTz: "Europe/Belgrade",
    });
    expect(md).toContain("### Trade #11 — MNQ Long · propušten 2026-09-29 16:00");
    expect(md).toContain("- **Hipotetički ishod (R2):** cena je došla do ulaza, pa do targeta: +3.00R");
    expect(md).toContain("cena se nije vratila do ulaza — setup nije ni došao, to nije oklevanje: +0.00R");
    expect(md).toContain("- **Hipotetički ishod (R2):** još nije izmereno");
    expect(md).not.toContain("Missed at");
  });

  it("prints a category once, leaves empty ones out and gives an all-breakeven group no win rate", () => {
    const tags: FieldDef = {
      id: "f1",
      key: "technical_tags",
      label: "Technical Tags",
      field_type: "tags",
      list_key: "technical_tags",
      show_phase: "always",
      sort_order: 0,
      is_active: true,
      show_when: "always",
    };
    const scratch = trade(5, "2026-09-30T15:00:00Z", "2026-09-30T15:05:00Z", 0);
    (scratch as unknown as { technical_tags: string[] }).technical_tags = ["FVG"];
    const md = buildMentorPack([...book, scratch], { fieldDefs: [tags] });
    expect(md.split("### Technical Tags").length - 1).toBe(1);
    expect(md).toContain("| FVG | 1 | — |");
    expect(md).not.toContain("### Setup Grade");
    expect(md).not.toContain("_no data_");
  });

  it("marks a trade typed in after its fill, whose R is measured from the fill", () => {
    const late = trade(6, "2026-09-30T16:00:00Z", "2026-09-30T16:10:00Z", 50);
    (late as unknown as { created_at: string }).created_at = "2026-09-30T18:00:00Z";
    const md = buildMentorPack([...book, late], { tzOf: () => "UTC", displayTz: "UTC" });
    expect(md).toContain("upisan posle ulaza (market) — R od fill-a");
  });
});

describe("ruleLabel", () => {
  it("keeps the name before the colon, shortens a long sentence and marks a deleted rule", () => {
    expect(ruleLabel({ text: "Dnevnik i tagovi: Unosim svaki trejd u aplikaciju", deleted_at: null })).toBe(
      "Dnevnik i tagovi",
    );
    expect(ruleLabel({ text: "Svaki trejd ima unet stop loss", deleted_at: null })).toBe("Svaki trejd ima unet stop loss");
    expect(
      ruleLabel({
        text: "Nema otvaranja novih pozicija 15 minuta pre i 15 minuta nakon važnih (crvenih) vesti.",
        deleted_at: "2026-09-29T00:00:00Z",
      }),
    ).toBe("Nema otvaranja novih pozicija 15 minuta pre i… (ukinuto)");
  });
});

describe("šta bi bilo u mentor pack-u (faza L)", () => {
  it("sažima mrežu i ono što je došlo posle stopa, i ćuti bez izmerenih trejdova", async () => {
    const { scenarioSection, tradeContextLines } = await import("./mentor-intraday");
    const { enrich, scenarioDoc } = await import("./reports/test-helpers");
    const trades = enrich([
      { r: -1, scenario: scenarioDoc() },
      { r: 2, scenario: scenarioDoc({}, (i, j) => (i === 2 && j <= 4 ? [1, 1.5, 2, 2.5, 3][j] : -1)) },
    ]);
    const md = scenarioSection(trades).join("\n");
    expect(md).toContain("## Šta bi bilo — SL × TP i cena posle izlaza (2 izmerena trejda ⚠)");
    expect(md).toContain("| Posle stopa došao planirani TP | 2 od 2 |");
    expect(md).toContain("| Najbolji TP na mom SL-u | 3R →");
    expect(scenarioSection(enrich([{ r: 1 }]))).toEqual([]);
    const line = tradeContextLines(trades[0], { displayTz: "UTC" }).join("\n");
    expect(line).toContain("- **Šta bi bilo:** 30 min posle izlaza +2.50R u mom pravcu / -0.20R protiv · posle stopa TP došao za 40 min · SL za TP +1.30R");
  });
});

describe("rulesSection (phase M)", () => {
  const rule = {
    id: "r1",
    text: "Kalendar i HTF",
    stage: "prepare" as const,
    active_days: [1, 2, 3, 4, 5],
    auto_key: null,
    config: {},
    is_mandatory: true,
    sort_order: 0,
    created_at: "2026-01-01T00:00:00Z",
    deleted_at: null,
  };
  const day = (date: string, status: DayCompliance["status"], pct: number | null) => ({
    date,
    applicable: pct == null ? 0 : 1,
    satisfied: pct === 100 ? 1 : 0,
    pct,
    status,
    missedRuleIds: pct === 0 ? ["r1"] : [],
    unansweredRuleIds: [],
  });

  it("averages only judged days and names the unlogged and the still-open ones", () => {
    const text = rulesSection([rule], [
      day("2026-10-05", "unlogged", null),
      day("2026-10-06", "compliant", 100),
      day("2026-10-07", "pending", 0),
    ]).join("\n");
    expect(text).toContain("prosek **100%** na 1 dan");
    expect(text).toContain("Bez prijave (nijedan trejd, nijedan odgovor, nijedan izveštaj): 1 dan — 2026-10-05");
    expect(text).toContain("U toku (ne ulazi u prosek): 2026-10-07");
    expect(text).not.toContain("Najčešće prekršeno");
  });
});

describe("mentor pack, phase M: what the mentor needs to question the day", () => {
  // 07.10.2026, 10:20:37 ET. Logged plan-first with a sealed stop that was later moved.
  const base = trade(7, "2026-10-07T14:20:37Z", "2026-10-07T15:49:06Z", 716.34, 3);
  const m = {
    ...base,
    position_size: null,
    playbook_id: "pb1",
    stop_price: 31196.25,
    target_price: 31366.5,
    entry_price: 31246.5,
    plan_snapshot: { entry_price: 31246.5, stop_price: 31190, target_price: 31366.5 },
    risk_budget_at_entry: 300,
    room_at_entry: 2716.34,
    stats: {
      ...base.stats!,
      avg_entry: 31246.5,
      avg_exit: 31366.5,
      gross_pl: 720,
      total_fees: 3.66,
      point_value: 2,
    },
  } as unknown as TradeRow;
  const fills = new Map([
    [
      m.id,
      [
        { side: "entry", qty: 2, price: 31246.5, executed_at: "2026-10-07T14:20:37Z" },
        { side: "entry", qty: 1, price: 31230, executed_at: "2026-10-07T14:30:00Z" },
        { side: "exit", qty: 3, price: 31366.5, executed_at: "2026-10-07T15:49:06Z" },
      ],
    ],
  ]);
  const dayBrief: SessionBrief = {
    tradingDay: "2026-10-07",
    flatBy: "2026-10-07T20:10:00Z",
    dayNote: null,
    redWindows: [{ from: "2026-10-07T12:25:00Z", to: "2026-10-07T12:45:00Z", title: "CPI", impact: "visok" }],
    droppedWindows: 0,
    ranges: {},
    sourceUrl: null,
  };
  const manual: TrackerRule = { ...rule, id: "r-cal", text: "Kalendar i HTF", stage: "prepare", auto_key: null };
  const week: DayCompliance[] = [
    { date: "2026-10-05", applicable: 0, satisfied: 0, pct: null, status: "unlogged", missedRuleIds: [], unansweredRuleIds: ["r-cal"] },
    { date: "2026-10-06", applicable: 1, satisfied: 1, pct: 100, status: "compliant", missedRuleIds: [], unansweredRuleIds: [], notApplicableRuleIds: ["r-stop"] },
    { date: "2026-10-07", applicable: 2, satisfied: 1, pct: 50, status: "broken", missedRuleIds: ["r-cal"], unansweredRuleIds: ["r-cal"] },
  ];
  const mpack = (periodLabel: string) =>
    buildMentorPack([m], {
      tzOf: () => "UTC",
      displayTz: "Europe/Belgrade",
      periodLabel,
      periodDays: ["2026-10-05", "2026-10-06", "2026-10-07"],
      briefs: [dayBrief],
      trackerRules: [rule, manual],
      compliance: week,
      executions: fills,
      playbookNames: new Map([["pb1", "Ponoć pojas"]]),
      reports: [
        { report_date: "2026-10-06", mental_temp: 3, no_trade_day: true, locked_at: "2026-10-06T21:00:00Z" },
        { report_date: "2026-10-07", mental_temp: 4, no_trade_day: false },
      ],
    });

  it("reads the contracts from the fills, not the empty planned size", () => {
    const md = mpack("Week");
    expect(md).toContain("trajanje 1h 28m · 3 ugovora");
    expect(md).toContain("| Prosečna veličina | 3.0 ugovora |");
  });

  it("prints the execution, every fill and an add against the position", () => {
    const md = mpack("Week");
    expect(md).toContain(
      "- **Izvršenje:** ulaz 3 @ 31246.5 · izlaz 3 @ 31366.5 · gross +720.00 USD · provizije 3.66 USD · net +716.34 USD · fill-ova 2 ulaz / 1 izlaz",
    );
    expect(md).toContain(
      "- **Fill-ovi (ET):** 10:20:37 ulaz 2 @ 31246.5 · 10:30:00 ulaz 1 @ 31230 ⚠ dodato protiv pozicije · 11:49:06 izlaz 3 @ 31366.5",
    );
  });

  it("compares the sealed plan with how the trade ended, and the risk with its budget", () => {
    const md = mpack("Week");
    expect(md).toContain("- **Plan → kraj:** stop 31190 → 31196.25 · cilj nepromenjen (31366.5)");
    expect(md).toContain("- **Rizik na ulazu:** budžet 300.00 USD · uzeto 339.00 USD (113% budžeta) · 12.5% prostora do MLL-a (prostor 2716.34 USD)");
    expect(md).toContain("- **Playbook:** Ponoć pojas");
  });

  it("lists every weekday of the period, the ones without a trade included", () => {
    const md = mpack("Week");
    expect(md).toContain("## Dnevni pregled (3 dana u periodu, 1 sa trejdovima)");
    expect(md).toContain("| 2026-10-05 | 0 | — | — | — | — | — | — | — | — | bez prijave | — |");
    expect(md).toContain("| 2026-10-06 | 0 | — | — | — | — | — | — | 3/5 | da · zaključan | 100% | — |");
    expect(md).toContain("| 2026-10-07 | 1 | 1/0/0 | 716.34 |");
  });

  it("shows the tracker rule by rule for each day, with the day's red windows", () => {
    const md = mpack("Week");
    expect(md).toContain("## Tracker po danu");
    expect(md).toContain("### 2026-10-05 · bez prijave");
    expect(md).toContain("- Crveni prozori (ET): 08:25–08:45 CPI (visok) · flat do 16:10 ET");
    expect(md).toContain("? Kalendar i HTF (neodgovoreno)");
    expect(md).toContain("— Bez ulaza posle dnevnog cilja (n/a)");
    expect(md).toContain("✓ Kalendar i HTF");
  });

  it("totals the commissions", () => {
    expect(mpack("Week")).toContain("| Provizije ukupno | 3.66 USD |");
  });

  it("asks to be questioned on a day pack, and for a review with homework on a week pack", () => {
    const day = mpack("Day");
    expect(day).toContain("Ovo je **zatvaranje dana**");
    expect(day).not.toContain("pravila za sledeću nedelju");
    const wk = mpack("Week");
    expect(wk).toContain("0. **Domaći**");
    expect(wk).toContain("2–3 pravila za sledeću nedelju");
  });
});

describe("plan → kraj on an imported trade (phase M fix)", () => {
  it("an empty seal is not a plan: it says so instead of printing '— →'", () => {
    const t = {
      ...trade(9, "2026-10-07T14:20:37Z", "2026-10-07T15:49:06Z", 716.34, 3),
      created_at: "2026-10-07T16:10:45Z",
      plan_snapshot: {},
      stop_price: 31196.25,
      target_price: 31366.5,
    } as unknown as TradeRow;
    const md = buildMentorPack([t], { tzOf: () => "UTC", displayTz: "Europe/Belgrade" });
    expect(md).toContain("- **Plan → kraj:** upisan posle ulaza — plana pre ulaza nije bilo");
    expect(md).not.toContain("stop — →");
  });
});

describe("the stop line from the orders export (phase O)", () => {
  it("trade #1: original from the recording, last stop from the file, moved", () => {
    const t = {
      ...trade(10, "2026-10-07T14:20:37Z", "2026-10-07T15:49:06Z", 716.34, 3),
      created_at: "2026-10-07T16:10:45Z",
      plan_snapshot: {},
      direction: "Long",
      stop_price: 31196.25,
      final_stop_price: 31227.5,
      max_drawdown_price: 31206.5,
      exit_reason: "Pogođen target",
      entry_order_type: "market",
    } as unknown as TradeRow;
    t.stats = { ...t.stats!, avg_entry: 31246.5 };
    const md = buildMentorPack([t], { tzOf: () => "UTC", displayTz: "Europe/Belgrade" });
    expect(md).toContain(
      "- **Stop:** originalni 31196.25 · poslednji u platformi 31227.5 · pomeren posle ulaza (cena išla do 31206.5, dalje od poslednjeg)",
    );
    expect(md).toContain("- **Ulaz:** market nalog");
  });
});

