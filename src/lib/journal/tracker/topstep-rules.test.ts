import { describe, expect, it } from "vitest";
import { buildTradeDayIndex, evaluateAutoRulesForDay } from "./auto-rules";
import { bookEquityLadder } from "./equity-ladder";
import { topstepRulesResolver } from "../topstep";
import { accountDayZoneResolver } from "../time";
import type { Account, TradeRow } from "../types";

/**
 * F3: the tracker's money rules on a Topstep account read the PLAN, not a
 * percentage of equity (decisions E1–E5, 28.09.2026).
 *
 *   - daily loss = the plan's DLL, per account and per Topstep day;
 *   - loss per trade = the risk budget at entry + 10 % for slippage;
 *   - weekly loss: Topstep has none, so Topstep trades are not graded;
 *   - risk per trade = the budget at entry;
 *   - sized to intent = the contracts the form would have computed.
 *
 * Every other account keeps its percentage, measured against the capital of
 * the accounts that are NOT Topstep — a 50K Topstep balance is not money a CFD
 * limit is a share of.
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
    risk_rule_pct: 12.5,
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

// Tue 29.09.2026, 10:00 CT — the middle of a Topstep day.
const AT = "2026-09-29T15:00:00Z";
const DAY = "2026-09-29";
const index = (specs: Spec[]) =>
  buildTradeDayIndex(specs.map(row), (r) => zoneOf(r.account_id), topstepOf);
const ladder = (specs: Spec[]) => bookEquityLadder(index(specs), ACCOUNTS, [], zoneOf);
const evalDay = (specs: Spec[]) => evaluateAutoRulesForDay(DAY, index(specs));

describe("daily loss on a Topstep account is the plan's DLL (E1)", () => {
  it("fails at the DLL, with nothing configured on the rule", () => {
    const out = evalDay([{ id: "a", account: "ts", opened: AT, net: -1_000 }]);
    expect(out.max_loss_per_day.verdict).toBe("fail");
    expect(out.max_loss_per_day.observed).toBe(-1_000);
    expect(out.max_loss_per_day.limit).toBe(-1_000);
    expect(out.max_loss_per_day.basis).toBe("topstep_dll");
  });

  it("passes a dollar under it", () => {
    const out = evalDay([{ id: "a", account: "ts", opened: AT, net: -999 }]);
    expect(out.max_loss_per_day.verdict).toBe("pass");
  });

  it("is per account: two 50Ks each down 600 are two survived days, not one lost one", () => {
    const out = evalDay([
      { id: "a", account: "ts", opened: AT, net: -600 },
      { id: "b", account: "ts2", opened: AT, net: -600 },
    ]);
    expect(out.max_loss_per_day.verdict).toBe("pass");
  });

  it("grades only the Topstep account on a mixed day (H2, I4)", () => {
    const out = evalDay([
      { id: "ts-ok", account: "ts", opened: AT, net: -500 },
      { id: "cfd-big", account: "cfd", opened: AT, net: -5_000 },
    ]);
    expect(out.max_loss_per_day.verdict).toBe("pass");
    expect(out.max_loss_per_day.observed).toBe(-500);
  });

  it("a day with only other accounts' trades is not graded, and says why", () => {
    const out = evalDay([{ id: "c", account: "cfd", opened: AT, net: -5_000 }]);
    expect(out.max_loss_per_day.reason).toBe("no_topstep_trades");
    expect(out.max_loss_per_trade.reason).toBe("no_topstep_trades");
  });
});

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

describe("loss per trade: the budget at entry, plus 10 % for slippage (E3)", () => {
  it("a stop filled a tick or two late is not a breach", () => {
    const out = evalDay([{ id: "a", account: "ts", opened: AT, net: -270, budget: 250 }]);
    expect(out.max_loss_per_trade.verdict).toBe("pass");
    expect(out.max_loss_per_trade.limit).toBeCloseTo(-275);
  });

  it("past the tolerance it is", () => {
    const out = evalDay([{ id: "a", account: "ts", opened: AT, net: -280, budget: 250 }]);
    expect(out.max_loss_per_trade.verdict).toBe("fail");
    expect(out.max_loss_per_trade.observed).toBe(-280);
    expect(out.max_loss_per_trade.basis).toBe("topstep_budget_slippage");
  });

  it("without a sealed budget, reads the one the account allowed at entry (E4 fallback)", () => {
    // Nothing closed before: room 2 000 → 12.5 % = 250 → limit -275.
    const out = evalDay([{ id: "a", account: "ts", opened: AT, net: -280 }]);
    expect(out.max_loss_per_trade.verdict).toBe("fail");
    expect(out.max_loss_per_trade.limit).toBeCloseTo(-275);
  });
});

describe("risk per trade is the budget at entry (E1)", () => {
  // MNQ: 50 points × $2 = $100 a contract at the stop.
  it("one contract inside a 250 budget passes", () => {
    const out = evalDay([{ id: "a", account: "ts", opened: AT, qty: 1, budget: 250 }]);
    expect(out.risk_per_trade.verdict).toBe("pass");
    expect(out.risk_per_trade.limit).toBe(250);
  });

  it("three contracts — 300 at risk — break it", () => {
    const out = evalDay([{ id: "a", account: "ts", opened: AT, qty: 3, budget: 250 }]);
    expect(out.risk_per_trade.verdict).toBe("fail");
    expect(out.risk_per_trade.observed).toBe(300);
    expect(out.risk_per_trade.basis).toBe("topstep_budget");
  });
});

describe("sized to intent = the contracts the form would have computed (E5)", () => {
  // Per contract: 50 pt × $2 + 2 × $0.62 commission = $101.24; 250 buys 2.
  it("two contracts on a 250 budget is the plan", () => {
    const out = evalDay([{ id: "a", account: "ts", opened: AT, qty: 2, budget: 250 }]);
    expect(out.risk_matched_intent.verdict).toBe("pass");
  });

  it("one is under-sized, three over — both miss", () => {
    expect(evalDay([{ id: "a", account: "ts", opened: AT, qty: 1, budget: 250 }]).risk_matched_intent.verdict).toBe("fail");
    expect(evalDay([{ id: "a", account: "ts", opened: AT, qty: 3, budget: 250 }]).risk_matched_intent.verdict).toBe("fail");
  });

  it("on an Express Funded Account the cap is the Scaling Plan at the entry, not the plan's (phase T)", () => {
    // A fresh 50K XFA at $0: two minis = twenty micros, whatever the budget buys.
    const XFA = { ...acc("xfa", true, 0), topstep_stage: "xfa" } as unknown as Account;
    const accounts = [XFA];
    const zone = accountDayZoneResolver(accounts, XFA);
    const ix = (qty: number) =>
      buildTradeDayIndex(
        [row({ id: "a", account: "xfa", opened: AT, qty, budget: 6_100, stop: 19_950 })],
        (r) => zone(r.account_id),
        topstepRulesResolver(accounts),
      );
    expect(evaluateAutoRulesForDay(DAY, ix(20)).risk_matched_intent.verdict).toBe("pass");
    expect(evaluateAutoRulesForDay(DAY, ix(50)).risk_matched_intent.verdict).toBe("fail");
  });

  it("the plan's contract cap counts: 50 micros on a 50K is the most there is", () => {
    // A budget that would buy 60 micros: the cap of 50 is the plan.
    const out = evalDay([{ id: "a", account: "ts", opened: AT, qty: 50, budget: 6_100, stop: 19_950 }]);
    expect(out.risk_matched_intent.verdict).toBe("pass");
  });
});
