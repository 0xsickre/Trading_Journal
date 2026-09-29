import { describe, expect, it } from "vitest";
import { buildTradeDayIndex, evaluateAutoRulesForDay, type AutoConfigs } from "./auto-rules";
import { topstepRulesResolver } from "../topstep";
import { accountDayZoneResolver } from "../time";
import { briefResolver, parseSessionBrief, type SessionBrief } from "../session-brief";
import type { Account, TradeRow } from "../types";

/**
 * F4: the four day-trading rules (decisions G5, G7, G9, 28.09.2026).
 *
 *   - max_trades_per_day: at most N entries per ACCOUNT per Topstep day;
 *   - stop_after_losses: no entry after N consecutive losses on that account
 *     that day — the losses must have CLOSED before the entry;
 *   - flat_by_close: a Topstep position is flat by the end of the Topstep day
 *     (15:10 CT, or the brief's holiday / early close);
 *   - no_entry_in_red_window: no entry inside a red window of the day's brief,
 *     and nothing is graded without one.
 */

const NY = "America/New_York";
const acc = (id: string, topstep: boolean) =>
  ({
    id,
    timezone: NY,
    topstep_mode: topstep,
    topstep_plan: "50K",
    starting_balance: 50_000,
    topstep_payout_at: null,
    topstep_reset_at: null,
    risk_rule_pct: 12.5,
    risk_rule_min: null,
    risk_rule_max: null,
  }) as unknown as Account;

const TS = acc("ts", true);
const TS2 = acc("ts2", true);
const CFD = acc("cfd", false);
const ACCOUNTS = [TS, TS2, CFD];
const zoneOf = accountDayZoneResolver(ACCOUNTS, TS);

type Spec = { id: string; account?: string; opened: string; closed?: string | null; net?: number | null };

function row(s: Spec): TradeRow {
  return {
    id: s.id,
    account_id: s.account ?? "ts",
    trade_no: null,
    status: s.closed === null ? "open" : "closed",
    source: "manual",
    needs_review: false,
    created_at: s.opened,
    instrument: "MNQ",
    playbook_id: "pb",
    entry_price: 20_000,
    stop_price: 19_950,
    stats: {
      position_id: s.id,
      avg_entry: 20_000,
      avg_exit: 20_000,
      entry_qty: 1,
      exit_qty: 1,
      gross_pl: s.net ?? 0,
      net_pl: s.net === undefined ? 0 : s.net,
      total_fees: 1.24,
      realized_r: null,
      realized_r_net: null,
      opened_at: s.opened,
      closed_at: s.closed === undefined ? s.opened : s.closed,
      duration_seconds: null,
      point_value: 2,
      fx_rate: 1,
      tick_size: 0.25,
      point_value_source: s.net === null ? "missing" : "snapshot",
    },
  } as unknown as TradeRow;
}

const DAY = "2026-09-29";
const index = (specs: Spec[]) =>
  buildTradeDayIndex(specs.map(row), (r) => zoneOf(r.account_id), topstepRulesResolver(ACCOUNTS));
const COUNTS: AutoConfigs = { max_trades_per_day: { count: 2 }, stop_after_losses: { count: 2 } };
const evalDay = (specs: Spec[], ctx: { briefs?: SessionBrief[]; now?: number } = {}, configs = COUNTS) =>
  evaluateAutoRulesForDay(DAY, index(specs), configs, () => null, {
    briefOf: briefResolver(ctx.briefs ?? []),
    now: ctx.now ?? Date.parse("2026-09-30T12:00:00Z"),
  });

// 29.09.2026 is in US summer time: 10:00 New York = 14:00 UTC, 15:10 CT = 20:10 UTC.
const at = (hhmm: string) => `${DAY}T${hhmm}:00Z`;

describe("max_trades_per_day", () => {
  it("fails the entry past N on one account, and names only that one", () => {
    const r = evalDay([
      { id: "a", opened: at("14:00") },
      { id: "b", opened: at("14:30") },
      { id: "c", opened: at("15:00") },
    ]).max_trades_per_day;
    expect(r.verdict).toBe("fail");
    expect(r.offenders).toEqual(["c"]);
    expect(r.counted).toEqual({ observed: 3, limit: 2 });
  });

  it("counts per account: two and two on two accounts is not four (G9)", () => {
    const r = evalDay([
      { id: "a", opened: at("14:00") },
      { id: "b", opened: at("14:30") },
      { id: "c", account: "ts2", opened: at("14:10") },
      { id: "d", account: "ts2", opened: at("14:40") },
    ]).max_trades_per_day;
    expect(r.verdict).toBe("pass");
    expect(r.counted).toEqual({ observed: 2, limit: 2 });
  });

  it("counts the Sunday evening entry in Monday's Topstep day", () => {
    // Sunday 27.09 18:30 New York = 22:30 UTC, after 17:00 CT: Monday 28.09.
    const idx = index([
      { id: "sun", opened: "2026-09-27T22:30:00Z" },
      { id: "m1", opened: "2026-09-28T14:00:00Z" },
      { id: "m2", opened: "2026-09-28T15:00:00Z" },
    ]);
    const r = evaluateAutoRulesForDay("2026-09-28", idx, COUNTS).max_trades_per_day;
    expect(r.verdict).toBe("fail");
    expect(r.offenders).toEqual(["m2"]);
  });

  it("is not scored without a count, and not on a day with no entries", () => {
    expect(evalDay([{ id: "a", opened: at("14:00") }], {}, {}).max_trades_per_day.reason).toBe("unconfigured");
    expect(evalDay([]).max_trades_per_day.reason).toBe("no_trades");
  });
});

describe("stop_after_losses", () => {
  it("fails the entry that follows N losses closed before it", () => {
    const r = evalDay([
      { id: "l1", opened: at("13:40"), closed: at("13:50"), net: -120 },
      { id: "l2", opened: at("14:00"), closed: at("14:20"), net: -80 },
      { id: "next", opened: at("14:40"), closed: at("15:00"), net: 200 },
    ]).stop_after_losses;
    expect(r.verdict).toBe("fail");
    expect(r.offenders).toEqual(["next"]);
    expect(r.counted).toEqual({ observed: 2, limit: 2 });
  });

  it("a win or a scratch between two losses breaks the run", () => {
    for (const between of [150, 0]) {
      const r = evalDay([
        { id: "l1", opened: at("13:40"), closed: at("13:50"), net: -120 },
        { id: "w", opened: at("14:00"), closed: at("14:10"), net: between },
        { id: "l2", opened: at("14:20"), closed: at("14:30"), net: -80 },
        { id: "next", opened: at("14:40"), closed: at("15:00"), net: 50 },
      ]).stop_after_losses;
      expect(r.verdict, String(between)).toBe("pass");
    }
  });

  it("does not count a loss that closed after the entry was taken", () => {
    const r = evalDay([
      { id: "l1", opened: at("13:40"), closed: at("13:50"), net: -120 },
      { id: "l2", opened: at("14:00"), closed: at("14:45"), net: -80 },
      { id: "overlap", opened: at("14:30"), closed: at("15:00"), net: 40 },
    ]).stop_after_losses;
    expect(r.verdict).toBe("pass");
  });

  it("counts per account: losses on one account do not stop the other", () => {
    const r = evalDay([
      { id: "l1", opened: at("13:40"), closed: at("13:50"), net: -120 },
      { id: "l2", opened: at("14:00"), closed: at("14:20"), net: -80 },
      { id: "other", account: "ts2", opened: at("14:40"), closed: at("15:00"), net: 10 },
    ]).stop_after_losses;
    expect(r.verdict).toBe("pass");
  });

  it("an unpriced trade in the run leaves the answer unknown, not passed", () => {
    const r = evalDay([
      { id: "l1", opened: at("13:40"), closed: at("13:50"), net: -120 },
      { id: "u", opened: at("14:00"), closed: at("14:20"), net: null },
      { id: "next", opened: at("14:40"), closed: at("15:00"), net: 10 },
    ]).stop_after_losses;
    expect(r.reason).toBe("unpriced");
  });
});

describe("flat_by_close", () => {
  it("passes a position closed before 15:10 CT and fails one closed after", () => {
    expect(evalDay([{ id: "ok", opened: at("14:00"), closed: at("20:05") }]).flat_by_close.verdict).toBe("pass");
    const late = evalDay([{ id: "late", opened: at("14:00"), closed: at("20:12") }]).flat_by_close;
    expect(late.verdict).toBe("fail");
    expect(late.offenders).toEqual(["late"]);
    expect(late.at).toBe("2026-09-29T20:10:00.000Z");
  });

  it("uses the brief's early close", () => {
    const early = parseSessionBrief({ trading_day: DAY, flat_by: at("17:00"), red_windows: [], ranges: {} })!;
    const r = evalDay([{ id: "t", opened: at("14:00"), closed: at("17:30") }], { briefs: [early] }).flat_by_close;
    expect(r.verdict).toBe("fail");
    expect(r.at).toBe("2026-09-29T17:00:00.000Z");
  });

  it("does not grade a position still open before the close, and fails it after", () => {
    const open = [{ id: "open", opened: at("14:00"), closed: null }];
    expect(evalDay(open, { now: Date.parse(at("18:00")) }).flat_by_close.reason).toBe("not_yet");
    expect(evalDay(open, { now: Date.parse(at("20:30")) }).flat_by_close.verdict).toBe("fail");
  });

  it("says the exchange was closed rather than grading against no time", () => {
    const closed = parseSessionBrief({ trading_day: DAY, flat_by: null, red_windows: [], ranges: {} })!;
    const r = evalDay([{ id: "t", opened: at("14:00") }], { briefs: [closed] }).flat_by_close;
    expect(r.reason).toBe("market_closed");
  });

  it("grades only Topstep accounts", () => {
    const r = evalDay([{ id: "c", account: "cfd", opened: at("14:00"), closed: at("21:00") }]).flat_by_close;
    expect(r.reason).toBe("no_topstep_trades");
  });
});

describe("no_entry_in_red_window", () => {
  const brief = parseSessionBrief({
    trading_day: DAY,
    flat_by: at("20:10"),
    red_windows: [{ from: at("12:25"), to: at("12:45"), title: "USD CPI m/m", impact: "visok" }],
    ranges: {},
  })!;

  it("fails an entry inside the window, edges included, and names the window", () => {
    const r = evalDay([
      { id: "edge", opened: at("12:45") },
      { id: "clear", opened: at("13:00") },
    ], { briefs: [brief] }).no_entry_in_red_window;
    expect(r.verdict).toBe("fail");
    expect(r.offenders).toEqual(["edge"]);
    expect(r.window).toBe("USD CPI m/m");
  });

  it("passes entries outside every window", () => {
    expect(evalDay([{ id: "a", opened: at("13:00") }], { briefs: [brief] }).no_entry_in_red_window.verdict).toBe(
      "pass",
    );
  });

  it("grades nothing without the day's brief (G7: only the brief's windows)", () => {
    expect(evalDay([{ id: "a", opened: at("12:30") }]).no_entry_in_red_window.reason).toBe("no_brief");
    expect(evalDay([]).no_entry_in_red_window.reason).toBe("no_trades");
  });
});
