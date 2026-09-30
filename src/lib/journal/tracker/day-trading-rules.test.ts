import { describe, expect, it } from "vitest";
import { buildTradeDayIndex, evaluateAutoRulesForDay } from "./auto-rules";
import { topstepRulesResolver } from "../topstep";
import { accountDayZoneResolver } from "../time";
import { briefResolver, parseSessionBrief, type SessionBrief } from "../session-brief";
import type { Account, TradeRow } from "../types";

/**
 * The day-trading rules (F4, G5/G7; 30.09.2026: money, never a count).
 *
 *   - no_entry_after_daily_target: no entry once the account's day has closed
 *     its personal daily profit target — the profit must have CLOSED before;
 *   - max_loss_per_day: the personal daily loss limit where tighter;
 *   - flat_by_close: a Topstep position is flat by the end of the Topstep day
 *     (15:10 CT, or the brief's holiday / early close);
 *   - no_entry_in_red_window: no entry inside a red window of the day's brief,
 *     and nothing is graded without one.
 */

const NY = "America/New_York";
const acc = (id: string, topstep: boolean, limits: { dll?: number; target?: number } = {}) =>
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
    topstep_personal_dll: limits.dll ?? null,
    topstep_daily_target: limits.target ?? null,
  }) as unknown as Account;

const TS = acc("ts", true);
const TS2 = acc("ts2", true);
const CFD = acc("cfd", false);
/** TopstepX Risk Limits: personal DLL 800 (plan 1 000), daily target 500. */
const TGT = acc("tgt", true, { dll: 800, target: 500 });
const ACCOUNTS = [TS, TS2, CFD, TGT];
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
const evalDay = (specs: Spec[], ctx: { briefs?: SessionBrief[]; now?: number } = {}) =>
  evaluateAutoRulesForDay(DAY, index(specs), {
    briefOf: briefResolver(ctx.briefs ?? []),
    now: ctx.now ?? Date.parse("2026-09-30T12:00:00Z"),
  });

// 29.09.2026 is in US summer time: 10:00 New York = 14:00 UTC, 15:10 CT = 20:10 UTC.
const at = (hhmm: string) => `${DAY}T${hhmm}:00Z`;

describe("no_entry_after_daily_target", () => {
  it("fails an entry taken after the day's closed profit reached the target", () => {
    const r = evalDay([
      { id: "w1", account: "tgt", opened: at("13:40"), closed: at("13:50"), net: 300 },
      { id: "w2", account: "tgt", opened: at("14:00"), closed: at("14:20"), net: 250 },
      { id: "more", account: "tgt", opened: at("14:40"), closed: at("15:00"), net: -100 },
    ]).no_entry_after_daily_target;
    expect(r.verdict).toBe("fail");
    expect(r.offenders).toEqual(["more"]);
    expect(r.observed).toBe(550);
    expect(r.limit).toBe(500);
    expect(r.basis).toBe("daily_target");
  });

  it("does not count a win still open at the entry, nor limit how many trades are taken", () => {
    const r = evalDay([
      { id: "a", account: "tgt", opened: at("13:40"), closed: at("13:50"), net: 100 },
      { id: "b", account: "tgt", opened: at("14:00"), closed: at("14:50"), net: 600 },
      { id: "c", account: "tgt", opened: at("14:10"), closed: at("14:20"), net: -50 },
      { id: "d", account: "tgt", opened: at("14:30"), closed: at("14:40"), net: 20 },
    ]).no_entry_after_daily_target;
    expect(r.verdict).toBe("pass");
    expect(r.observed).toBe(100);
  });

  it("is unknown when an unpriced close precedes the entry", () => {
    const r = evalDay([
      { id: "x", account: "tgt", opened: at("13:40"), closed: at("13:50"), net: null },
      { id: "y", account: "tgt", opened: at("14:00"), closed: at("14:20"), net: 10 },
    ]).no_entry_after_daily_target;
    expect(r.reason).toBe("unpriced");
  });

  it("is not scored on an account without a target, nor on a day with no entries", () => {
    expect(evalDay([{ id: "a", opened: at("14:00") }]).no_entry_after_daily_target.reason).toBe("unconfigured");
    expect(evalDay([]).no_entry_after_daily_target.reason).toBe("no_trades");
  });
});

describe("max_loss_per_day with a personal daily loss limit", () => {
  it("grades the day against the personal limit where it is tighter than the plan's", () => {
    const r = evalDay([
      { id: "l1", account: "tgt", opened: at("13:40"), closed: at("13:50"), net: -500 },
      { id: "l2", account: "tgt", opened: at("14:00"), closed: at("14:20"), net: -300 },
    ]).max_loss_per_day;
    expect(r.verdict).toBe("fail");
    expect(r.limit).toBe(-800);
    expect(r.basis).toBe("personal_dll");
  });

  it("keeps the plan's DLL on an account without one", () => {
    const r = evalDay([{ id: "l1", opened: at("13:40"), closed: at("13:50"), net: -800 }]).max_loss_per_day;
    expect(r.verdict).toBe("pass");
    expect(r.limit).toBe(-1000);
    expect(r.basis).toBe("topstep_dll");
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
