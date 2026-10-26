import { describe, expect, it } from "vitest";
import { buildTradeDayIndex, evaluateAutoRulesForDay } from "./auto-rules";
import { topstepRulesResolver } from "../topstep";
import { accountDayZoneResolver } from "../time";
import { briefResolver, parseSessionBrief, type SessionBrief } from "../session-brief";
import type { Account, TradeRow } from "../types";

/**
 * The day-trading rules (F4, G5/G7). The money rules that used to sit here
 * left the tracker in phase X (X-1 B, 26.10.2026).
 *
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
    risk_rule_pct: 8,
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
const evalDay = (specs: Spec[], ctx: { briefs?: SessionBrief[]; now?: number } = {}) =>
  evaluateAutoRulesForDay(DAY, index(specs), {
    briefOf: briefResolver(ctx.briefs ?? []),
    now: ctx.now ?? Date.parse("2026-09-30T12:00:00Z"),
  });

// 29.09.2026 is in US summer time: 10:00 New York = 14:00 UTC, 15:10 CT = 20:10 UTC.
const at = (hhmm: string) => `${DAY}T${hhmm}:00Z`;

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

describe("stop_after_two_losses (08.10.2026: two SL in a row end the day)", () => {
  // Risk to the stop is $100 (50 points × $2), so the Topstep breakeven band is ±$10.
  const rule = (specs: Spec[]) => evalDay(specs).stop_after_two_losses;

  it("fails an entry taken after two losses in a row on the account", () => {
    const r = rule([
      { id: "l1", opened: at("13:40"), closed: at("13:50"), net: -100 },
      { id: "l2", opened: at("14:00"), closed: at("14:10"), net: -100 },
      { id: "third", opened: at("14:30"), closed: at("14:40"), net: 150 },
    ]);
    expect(r.verdict).toBe("fail");
    expect(r.offenders).toEqual(["third"]);
    expect(r.counted).toEqual({ observed: 2, limit: 2 });
  });

  it("a win between two losses breaks the run — not the end of the day", () => {
    const r = rule([
      { id: "l1", opened: at("13:40"), closed: at("13:50"), net: -100 },
      { id: "w", opened: at("14:00"), closed: at("14:10"), net: 150 },
      { id: "l2", opened: at("14:20"), closed: at("14:30"), net: -100 },
      { id: "next", opened: at("14:40"), closed: at("14:50"), net: -100 },
    ]);
    expect(r.verdict).toBe("pass");
    expect(r.counted).toEqual({ observed: 1, limit: 2 });
  });

  it("a scratch inside the breakeven band is not a stop loss and breaks the run too", () => {
    const r = rule([
      { id: "l1", opened: at("13:40"), closed: at("13:50"), net: -100 },
      { id: "scratch", opened: at("14:00"), closed: at("14:10"), net: -5 },
      { id: "l2", opened: at("14:20"), closed: at("14:30"), net: -100 },
      { id: "next", opened: at("14:40"), closed: at("14:50"), net: 50 },
    ]);
    expect(r.verdict).toBe("pass");
  });

  it("counts each account on its own, and only losses closed before the entry", () => {
    expect(
      rule([
        { id: "a", account: "ts", opened: at("13:40"), closed: at("13:50"), net: -100 },
        { id: "b", account: "ts2", opened: at("14:00"), closed: at("14:10"), net: -100 },
        { id: "c", account: "ts", opened: at("14:20"), closed: at("14:30"), net: -100 },
      ]).verdict,
    ).toBe("pass");
    expect(
      rule([
        { id: "a", opened: at("13:40"), closed: at("13:50"), net: -100 },
        { id: "b", opened: at("13:45"), closed: at("14:30"), net: -100 },
        { id: "c", opened: at("14:00"), closed: at("14:10"), net: -100 },
      ]).verdict,
    ).toBe("pass");
  });

  it("is unknown behind an unpriced close, and not scored without entries", () => {
    expect(
      rule([
        { id: "l1", opened: at("13:40"), closed: at("13:50"), net: -100 },
        { id: "x", opened: at("14:00"), closed: at("14:10"), net: null },
        { id: "next", opened: at("14:20"), closed: at("14:30"), net: 10 },
      ]).reason,
    ).toBe("unpriced");
    expect(rule([]).reason).toBe("no_trades");
  });
});
