import { describe, expect, it } from "vitest";
import { buildTradeDayIndex } from "./auto-rules";
import { bookEquityLadder } from "./equity-ladder";
import { topstepRulesResolver } from "../topstep";
import { accountDayZoneResolver } from "../time";
import type { Account, TradeRow } from "../types";

/**
 * F3 (E1): the Survival ladder leaves Topstep capital out. The money rules
 * this file used to test left the tracker in phase X (X-1 B, 26.10.2026); the
 * ladder goes with Survival in X3.
 */

const NY = "America/New_York";
const acc = (id: string, topstep: boolean, starting_balance: number) =>
  ({
    id,
    timezone: NY,
    topstep_mode: topstep,
    topstep_plan: "50K",
    starting_balance,
    topstep_payout_at: null,
    topstep_reset_at: null,
    risk_rule_pct: 8,
    risk_rule_min: null,
    risk_rule_max: null,
  }) as unknown as Account;

const TS = acc("ts", true, 50_000);
const TS2 = acc("ts2", true, 50_000);
const CFD = acc("cfd", false, 10_000);
const ACCOUNTS = [TS, TS2, CFD];
const zoneOf = accountDayZoneResolver(ACCOUNTS, TS);
const topstepOf = topstepRulesResolver(ACCOUNTS);

type Spec = {
  id: string;
  account: string;
  opened: string;
  closed?: string | null;
  net?: number | null;
  qty?: number;
  entry?: number;
  stop?: number;
  budget?: number | null;
  fees?: number;
  instrument?: string;
};

function row(s: Spec): TradeRow {
  const qty = s.qty ?? 1;
  return {
    id: s.id,
    account_id: s.account,
    trade_no: null,
    status: s.closed === null ? "open" : "closed",
    source: "manual",
    needs_review: false,
    created_at: s.opened,
    instrument: s.instrument ?? "MNQ",
    playbook_id: "pb",
    entry_price: s.entry ?? 20_000,
    stop_price: s.stop ?? 19_950,
    risk_budget_at_entry: s.budget === undefined ? null : s.budget,
    stats: {
      position_id: s.id,
      avg_entry: s.entry ?? 20_000,
      avg_exit: 20_000,
      entry_qty: qty,
      exit_qty: qty,
      gross_pl: s.net ?? 0,
      net_pl: s.net === undefined ? 0 : s.net,
      total_fees: s.fees ?? 1.24 * qty,
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
  buildTradeDayIndex(specs.map(row), (r) => zoneOf(r.account_id), topstepOf);
const ladder = (specs: Spec[]) => bookEquityLadder(index(specs), ACCOUNTS, [], zoneOf);

describe("the Survival ladder leaves Topstep capital out (E1)", () => {
  it("opens on the CFD accounts' balance only, and moves only with their trades", () => {
    const l = ladder([
      { id: "ts-win", account: "ts", opened: "2026-09-28T15:00:00Z", net: 2_000 },
      { id: "cfd-win", account: "cfd", opened: "2026-09-28T15:00:00Z", net: 300 },
    ]);
    expect(l("2026-09-28")).toBe(10_000);
    expect(l(DAY)).toBe(10_300);
  });
});
