import { describe, expect, it } from "vitest";
import { buildTradeDayIndex, evaluateAutoRulesForDay } from "./auto-rules";
import { tradingWindowResolver } from "./trading-window";
import type { TrackerRule } from "../tracker-types";
import { missingReview } from "../review-gaps";
import { accountDayZoneResolver } from "../time";
import type { Account, TradeRow } from "../types";

/**
 * Phase Q (14.10.2026): the manual ticks the trade page already answers.
 *
 * The fixture is 13.10.2026 as the journal holds it — #2 short with no playbook
 * and #3 long — and every verdict is the one the mentor reached by hand in
 * `trading-mentor/dnevnik/2026-10-13.md`.
 */

const TS = {
  id: "ts",
  timezone: "Europe/Belgrade",
  starting_balance: 50_000,
} as unknown as Account;
const zoneOf = accountDayZoneResolver([TS], TS);

type Review = {
  playbook?: string | null;
  bias?: string | null;
  thesis?: string;
  grade?: number | null;
  psychology?: string[];
  mistake?: string[];
  images?: number;
  closed?: string | null;
  note?: string;
};

function trade(id: string, opened: string, net: number, r: Review): TradeRow {
  return {
    id,
    account_id: "ts",
    trade_no: null,
    status: r.closed === null ? "open" : "closed",
    source: "import",
    needs_review: false,
    created_at: "2026-10-14T06:00:00Z",
    instrument: "MNQ",
    direction: "Long",
    playbook_id: r.playbook === undefined ? "pb" : r.playbook,
    stop_price: 30_628.5,
    final_stop_price: 30_700.5,
    entry_order_type: "market",
    thesis: r.thesis ?? "BOS na 5 min",
    execution_rating: r.grade === undefined ? 1 : r.grade,
    exit_reason: "Trading prozor zavrsen",
    trade_journal_notes: r.note ?? "Ušao pre potvrde.",
    psychology_tags: r.psychology ?? ["Smiren"],
    mistake: r.mistake ?? ["Nisam imao Daily bias odredjen"],
    custom: { entry_tf: "5m", htf_bias: r.bias === undefined ? "NIsam odredio unapred" : r.bias },
    chart_images: Array.from({ length: r.images ?? 2 }, (_, i) => `img-${i}`),
    stats: {
      position_id: id,
      avg_entry: 30_693.75,
      avg_exit: 30_760.25,
      entry_qty: 2,
      exit_qty: 2,
      gross_pl: net,
      net_pl: net,
      total_fees: 2.44,
      realized_r: null,
      realized_r_net: null,
      opened_at: opened,
      closed_at: r.closed === undefined ? "2026-10-13T09:58:57Z" : r.closed,
      duration_seconds: null,
      point_value: 2,
      fx_rate: 1,
      tick_size: 0.25,
      point_value_source: "snapshot",
    },
  } as unknown as TradeRow;
}

const day = (rows: TradeRow[]) =>
  evaluateAutoRulesForDay("2026-10-13", buildTradeDayIndex(rows, (row) => zoneOf(row.account_id)));

const T2 = (r: Review = {}) =>
  trade("t2", "2026-10-13T07:24:39Z", -226.88, { playbook: null, mistake: ["Rani ulaz", "Bez Setupa"], psychology: ["Nestrpljiv", "FOMO"], ...r });
const T3 = (r: Review = {}) =>
  trade("t3", "2026-10-13T07:44:32Z", 263.56, { psychology: ["Ispoštovao rizik", "Vodio po planu", "Smiren"], ...r });

describe("phase Q review rules on 13.10.2026", () => {
  it("the day's bias is not a rule any more (phase E): no verdict, whatever the trade's old field says", () => {
    expect(Object.keys(day([T2(), T3()]))).not.toContain("htf_bias_set");
  });

  it("thesis: written on both → pass; an empty one → that trade", () => {
    expect(day([T2(), T3()]).thesis_recorded.verdict).toBe("pass");
    const out = day([T2({ thesis: "  " }), T3()]).thesis_recorded;
    expect(out.offenders).toEqual(["t2"]);
  });

  it("review complete and screenshots: 13.10. had everything → pass (the manual ticks were left empty)", () => {
    const out = day([T2(), T3()]);
    expect(out.review_complete.verdict).toBe("pass");
    expect(out.screenshot_per_trade.verdict).toBe("pass");
  });

  it("review complete fails a trade with no mistake and no A; the feeling moved to /daily (phase B5)", () => {
    expect(day([T2(), T3({ psychology: [] })]).review_complete.verdict).toBe("pass");
    expect(day([T2(), T3({ mistake: [] })]).review_complete.offenders).toEqual(["t3"]);
    expect(day([T2(), T3({ mistake: [], grade: 5 })]).review_complete.verdict).toBe("pass");
  });

  it("review complete: a C asks for one sentence, a B does not (phase B5)", () => {
    expect(day([T2(), T3({ note: " " })]).review_complete.offenders).toEqual(["t3"]);
    expect(day([T2(), T3({ note: " ", grade: 3 })]).review_complete.verdict).toBe("pass");
  });

  it("a C-graded trade, the best or the worst with no chart fails screenshots", () => {
    expect(day([T2(), T3({ images: 0 })]).screenshot_per_trade.offenders).toEqual(["t3"]);
  });

  it("screenshots: a B between the best and the worst needs none (phase B6)", () => {
    const mid = trade("t4", "2026-10-13T08:30:00Z", 20, { grade: 3, images: 0 });
    expect(day([T2({ grade: 3 }), mid, T3({ grade: 3 })]).screenshot_per_trade.verdict).toBe("pass");
    expect(day([T2({ grade: 3 }), mid, T3({ grade: 3, images: 0 })]).screenshot_per_trade.offenders).toEqual(["t3"]);
    expect(day([T2({ grade: 3 }), { ...mid, execution_rating: 1 } as unknown as TradeRow, T3({ grade: 3 })]).screenshot_per_trade.offenders).toEqual(["t4"]);
  });

  it("honest tags: 13.10. passes — #3 claims the risk, and no risk rule broke on #3", () => {
    expect(day([T2(), T3()]).honest_tags.verdict).toBe("pass");
  });

  it("honest tags: an A on the trade that broke the playbook rule → broken", () => {
    const out = day([T2({ grade: 5 }), T3()]).honest_tags;
    expect(out.verdict).toBe("fail");
    expect(out.offenders).toEqual(["t2"]);
  });

  it("honest tags: 'Ispoštovao rizik' on a trade with no stop → broken", () => {
    const noStop = { ...T3(), stop_price: null, plan_snapshot: { stop_price: null } } as unknown as TradeRow;
    expect(day([T2(), noStop]).honest_tags.offenders).toEqual(["t3"]);
  });

  it("an open trade is not yet a gap", () => {
    const out = day([T3({ closed: null, images: 0, thesis: "" })]);
    expect(out.screenshot_per_trade.reason).toBe("not_yet");
    expect(out.thesis_recorded.reason).toBe("not_yet");
  });
});

describe("/daily: an imported trade without its orders (phase Q)", () => {
  it("is named, and stops being named once the orders file brought the stop", () => {
    const bare = { ...T3(), final_stop_price: null, entry_order_type: null } as unknown as TradeRow;
    expect(missingReview(bare)).toContain("orders");
    expect(missingReview(T3())).not.toContain("orders");
    expect(missingReview({ ...bare, source: "manual" } as unknown as TradeRow)).not.toContain("orders");
  });
});

describe("honest tags: 'Vodio po planu' needs a plan that existed (phase Y5)", () => {
  it("on a trade without a playbook → broken", () => {
    const out = day([T2({ psychology: ["Vodio po planu"] }), T3()]).honest_tags;
    expect(out.verdict).toBe("fail");
    expect(out.offenders).toEqual(["t2"]);
  });

  it("on a trade whose playbook was created after the entry → broken", () => {
    const late = { ...T3(), playbook_created_at: "2026-10-14T06:52:54Z" } as unknown as TradeRow;
    expect(day([T2(), late]).honest_tags.offenders).toEqual(["t3"]);
  });

  it("on a trade whose playbook existed before the entry → kept", () => {
    const early = { ...T3(), playbook_created_at: "2026-10-01T06:00:00Z" } as unknown as TradeRow;
    expect(day([T2(), early]).honest_tags.verdict).toBe("pass");
  });
});

describe("trading_window: entries and exits inside the day's window, Belgrade time (phase Y4)", () => {
  const windowRule = (windows: { since: string; from: string; to: string }[]): TrackerRule =>
    ({
      id: "tw",
      text: "Vreme trgovanja",
      stage: "trade",
      active_days: [1, 2, 3, 4, 5],
      auto_key: "trading_window",
      config: { windows },
      is_mandatory: true,
      sort_order: 0,
      created_at: "2026-10-01T00:00:00Z",
      deleted_at: null,
    }) as unknown as TrackerRule;
  const LONDON = windowRule([{ since: "2026-10-12", from: "09:00", to: "12:00" }]);
  const dayW = (rows: TradeRow[], rule: TrackerRule = LONDON, now = Date.parse("2026-10-14T00:00:00Z"), d = "2026-10-13") =>
    evaluateAutoRulesForDay(d, buildTradeDayIndex(rows, (row) => zoneOf(row.account_id)), {
      tradingWindowOf: tradingWindowResolver([rule]),
      now,
    }).trading_window;

  it("13.10.: #2 09:24–09:40 and #3 09:44–11:58:57 are inside 09:00–12:00", () => {
    const out = dayW([T2({ closed: "2026-10-13T07:40:10Z" }), T3()]);
    expect(out.verdict).toBe("pass");
    expect(out.window).toBe("09:00–12:00");
  });

  it("an entry before the window → broken", () => {
    const early = trade("t1", "2026-10-13T06:59:00Z", 10, { closed: "2026-10-13T07:30:00Z" });
    expect(dayW([early]).offenders).toEqual(["t1"]);
  });

  it("an exit in the minute of `to` is a time exit; the minute after is not", () => {
    expect(dayW([T3({ closed: "2026-10-13T10:00:40Z" })]).verdict).toBe("pass");
    expect(dayW([T3({ closed: "2026-10-13T10:01:00Z" })]).verdict).toBe("fail");
  });

  it("a position still open after `to` → broken; before it, not yet judged as a breach", () => {
    expect(dayW([T3({ closed: null })], LONDON, Date.parse("2026-10-13T10:05:00Z")).verdict).toBe("fail");
    expect(dayW([T3({ closed: null })], LONDON, Date.parse("2026-10-13T09:00:00Z")).verdict).toBe("pass");
  });

  it("a NY week reads its own window, and the change leaves the earlier day alone", () => {
    const both = windowRule([
      { since: "2026-10-12", from: "09:00", to: "12:00" },
      { since: "2026-10-19", from: "14:30", to: "18:00" },
    ]);
    const ny = trade("n1", "2026-10-19T12:35:00Z", 10, { closed: "2026-10-19T14:10:00Z" });
    expect(dayW([ny], both, Date.parse("2026-10-20T00:00:00Z"), "2026-10-19").verdict).toBe("pass");
    expect(dayW([T3()], both).verdict).toBe("pass");
  });

  it("no window for the day → unconfigured, never a pass", () => {
    const out = dayW([T3()], windowRule([{ since: "2026-10-19", from: "14:30", to: "18:00" }]));
    expect(out.verdict).toBe("na");
    expect(out.reason).toBe("unconfigured");
  });
});

describe("phase E: the journal holds no forecast of direction", () => {
  const D = "2026-10-28";
  const at = (t: string) => `${D}T${t}Z`;
  const onDay = (rows: TradeRow[]) =>
    evaluateAutoRulesForDay(D, buildTradeDayIndex(rows, (row) => zoneOf(row.account_id)));
  const tr = (id: string, opened: string, r: Review = {}) => trade(id, opened, 100, { bias: null, closed: opened, ...r });

  it("review complete passes a full review with no bias anywhere", () => {
    expect(onDay([tr("t1", at("08:00:00"))]).review_complete.verdict).toBe("pass");
  });

  it("an A on a trade with no bias is not a dishonest tag", () => {
    expect(onDay([tr("t1", at("08:00:00"), { grade: 5 })]).honest_tags.verdict).toBe("pass");
  });
});

describe("daily_psychology: the day's feeling, once on /daily (phase B5)", () => {
  const withReport = (rows: TradeRow[], tags: string[] | null) =>
    evaluateAutoRulesForDay("2026-10-13", buildTradeDayIndex(rows, (row) => zoneOf(row.account_id)), {
      reportOf: (d) => (d === "2026-10-13" && tags ? { psychology_tags: tags } : null),
    }).daily_psychology;

  it("a day with a trade and the feeling written → pass", () => {
    expect(withReport([T3()], ["Smiren"]).verdict).toBe("pass");
  });

  it("no report, or one with no feeling → broken", () => {
    expect(withReport([T3()], null).verdict).toBe("fail");
    expect(withReport([T3()], []).verdict).toBe("fail");
  });

  it("a day with no trade is not asked", () => {
    expect(withReport([], null).reason).toBe("no_trades");
  });
});
