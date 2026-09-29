import { describe, expect, it } from "vitest";
import { buildMentorPack } from "./mentor-export";
import { dimensionTable, SMALL_SAMPLE, sr } from "./mentor-intraday";
import { enrichTrades } from "./enriched-trade";
import { toRealized } from "./analytics";
import { evaluateTopstep } from "./topstep";
import type { PositionStat, TradeRow } from "./types";
import type { Insight } from "./insights/types";
import type { SessionBrief } from "./session-brief";
import type { TrackerRule } from "./tracker-types";
import type { DayCompliance } from "./tracker/compliance";

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
  text: "Stop posle 2 gubitka",
  stage: "trade",
  active_days: [1, 2, 3, 4, 5],
  auto_key: "stop_after_losses",
  config: { count: 2 },
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
  ruleId: "tilt_after_losses",
  level: "trade",
  severity: "critical",
  title: "Traded on after the loss limit",
  detail: "x",
  subjectId: book[2].id,
};

const topstep = evaluateTopstep(
  { enabled: true, plan: "50K", startingBalance: 50_000, payoutAt: null, resetAt: null },
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
        : [{ accountName: "Topstep 50K", plan: "50K", startingBalance: 50_000, riskRulePct: 12.5, result: topstep }],
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
    expect(md).toContain("12.5% prostora do MLL-a");
  });

  it("lists the trader's rules and the ones broken most", () => {
    const md = pack();
    expect(md).toContain("- Stop posle 2 gubitka (trgovanje, obavezno · automatski: `stop_after_losses` = 2 · Mon, Tue, Wed, Thu, Fri)");
    expect(md).toContain("prosek **75%** na 2 dana; 1 dan bez ijednog prekršaja");
    expect(md).toContain("- Stop posle 2 gubitka — 1 dan");
  });

  it("gives one row per trading day with what a day trader is judged on", () => {
    const md = pack();
    expect(md).toContain("## Dnevni pregled (2 trading dana)");
    // 3 trades, all lost, first at 09:40 ET, a run of 3, one entry after two losses,
    // two contracts at most, half the rules kept, the mental note.
    expect(md).toContain(
      "| 2026-09-29 | 3 | 0/3/0 | -400.00 | -4.00R | 09:40 | 3 | 1 | 2 | 50% (Stop posle 2 gubitka) | 1 ulaz u crvenom prozoru, mentalno 4/10 |",
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
    expect(md).toContain("3. trejd dana · pre ulaza 2 gubitka zaredom · trajanje 10m · 2 ugovora");
    expect(md).toContain("- **Ulaz u crvenom prozoru:** CPI (visok) 09:58–10:05 ET");
    expect(md).toContain("- **Zapažanja na ovom trejdu:** Traded on after the loss limit");
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
