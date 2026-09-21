import { describe, expect, it } from "vitest";
import {
  buildTradeDayIndex,
  configsFromRules,
  evaluateAutoRulesForDay,
  type AutoConfigs,
} from "./auto-rules";
import type { TradeRow } from "../types";
import { AUTO_RULE_KEYS, AUTO_RULES_NEEDING_PCT } from "../tracker-types";

type Spec = {
  id: string;
  status?: string;
  opened: string; // ISO instant
  closed?: string | null;
  net?: number | null;
  playbook?: boolean;
  stop?: boolean;
  thesis?: boolean;
  /** Risk-at-entry inputs: the stop distance, the size, and the day's equity. */
  stopPrice?: number | null;
  qty?: number;
  equityAtEntry?: number | null;
  /** What the trader chose from the dropdown, as it is stored: text. */
  riskPct?: string | null;
};

function mkRow(s: Spec): TradeRow {
  return {
    id: s.id,
    account_id: "acc-1",
    trade_no: null,
    status: s.status ?? "closed",
    source: "manual",
    needs_review: false,
    created_at: s.opened,
    playbook_id: s.playbook === false ? null : "pb-1",
    stop_price: s.stop === false ? null : (s.stopPrice ?? 90),
    equity_at_entry: s.equityAtEntry === undefined ? null : s.equityAtEntry,
    risk_pct: s.riskPct === undefined ? null : s.riskPct,
    thesis: s.thesis === false ? null : "Written before entry",
    stats: {
      position_id: s.id,
      avg_entry: 100,
      avg_exit: null,
      entry_qty: s.qty ?? 1,
      exit_qty: 1,
      gross_pl: s.net ?? 0,
      net_pl: s.net === undefined ? 0 : s.net,
      total_fees: 0,
      total_swap: 0,
      realized_r: null,
      realized_r_net: null,
      opened_at: s.opened,
      closed_at: s.closed === undefined ? s.opened : s.closed,
      duration_seconds: null,
      point_value: 1,
      fx_rate: 1,
      tick_size: null,
      point_value_source: s.net === null ? "missing" : "snapshot",
    },
  } as unknown as TradeRow;
}

const index = (specs: Spec[], tz = "UTC") =>
  buildTradeDayIndex(specs.map(mkRow), () => tz);

/**
 * A flat book, so the percentages resolve to round money.
 *
 * The limits below are stated as shares of it and work out to exactly the -400
 * and -200 these tests were written against, which is why every assertion in
 * this file still reads the same after the move from money to percentages.
 */
const EQUITY = 10_000;
const flatEquity = () => EQUITY;

const LIMITS: AutoConfigs = {
  max_loss_per_day: { pct: 4 },
  max_loss_per_trade: { pct: 2 },
  max_loss_per_week: { pct: 6 },
  risk_per_trade: { pct: 2 },
};

const evalDay = (day: string, specs: Spec[], configs: AutoConfigs = LIMITS, tz = "UTC") =>
  evaluateAutoRulesForDay(day, index(specs, tz), configs, flatEquity);

describe("day attribution", () => {
  const swing: Spec = {
    id: "swing",
    opened: "2026-03-02T14:00:00Z",
    closed: "2026-03-04T14:00:00Z",
    net: -500,
    playbook: false,
    stop: false,
  };

  it("charges the daily loss to the CLOSE day", () => {
    const d3 = evalDay("2026-03-04", [swing]);
    expect(d3.max_loss_per_day.verdict).toBe("fail");
    expect(d3.max_loss_per_day.observed).toBe(-500);
  });

  it("leaves the open day untouched by the money rules", () => {
    const d1 = evalDay("2026-03-02", [swing]);
    expect(d1.max_loss_per_day.verdict).toBe("na");
    expect(d1.max_loss_per_day.reason).toBe("no_trades");
    expect(d1.max_loss_per_trade.verdict).toBe("na");
  });

  it("charges playbook and stop to the OPEN day", () => {
    const d1 = evalDay("2026-03-02", [swing]);
    expect(d1.playbook_linked.verdict).toBe("fail");
    expect(d1.stop_loss_set.verdict).toBe("fail");

    const d3 = evalDay("2026-03-04", [swing]);
    expect(d3.playbook_linked.verdict).toBe("na");
    expect(d3.stop_loss_set.verdict).toBe("na");
  });

  it("asks the SEALED plan whether the reason and the stop existed", () => {
    // The day alone cannot catch this one: the trade was entered with neither
    // a stop nor a reason, and both were typed in afterwards. Read from the
    // live row the day would score a clean entry.
    const backfilled = {
      ...mkRow(swing),
      stop_price: 90,
      thesis: "Written at the exit, about the exit",
      plan_snapshot: { stop_price: null, thesis: "" },
    } as unknown as TradeRow;
    const day = evaluateAutoRulesForDay(
      "2026-03-02",
      buildTradeDayIndex([backfilled], () => "UTC"),
      LIMITS,
      flatEquity,
    );
    expect(day.stop_loss_set.verdict).toBe("fail");
    expect(day.thesis_written.verdict).toBe("fail");
  });

  it("charges the thesis to the OPEN day, which is the whole rule", () => {
    // A thesis written afterwards is a rationalisation. The check is that the
    // reason existed BEFORE the position did, and only the open day can say so
    // — scoring it on the close day would pass a thesis typed at the exit.
    const late: Spec = { ...swing, thesis: false };
    expect(evalDay("2026-03-02", [late]).thesis_written.verdict).toBe("fail");
    expect(evalDay("2026-03-04", [late]).thesis_written.verdict).toBe("na");
  });

  it("passes a trade opened with a thesis", () => {
    expect(evalDay("2026-03-02", [swing]).thesis_written.verdict).toBe("pass");
  });

  it("does not accept whitespace as a thesis", () => {
    // Otherwise the rule is satisfied by pressing the spacebar.
    const blank = { ...mkRow({ ...swing, id: "blank" }), thesis: "   " };
    const out = evaluateAutoRulesForDay(
      "2026-03-02",
      buildTradeDayIndex([blank as TradeRow], () => "UTC"),
      LIMITS,
    );
    expect(out.thesis_written.verdict).toBe("fail");
    expect(out.thesis_written.offenders).toEqual(["blank"]);
  });

  it("fails an open trade with no playbook on its open day", () => {
    // The regression this guards: on close-day attribution a still-open trade is
    // invisible to the rule, so ten unlinked trades would report a perfect day.
    const open: Spec = {
      id: "live",
      status: "open",
      opened: "2026-03-02T14:00:00Z",
      closed: null,
      playbook: false,
    };
    const d1 = evalDay("2026-03-02", [open]);
    expect(d1.playbook_linked.verdict).toBe("fail");
    expect(d1.playbook_linked.offenders).toEqual(["live"]);
  });

  it("keeps an open position out of both money rules", () => {
    const open: Spec = {
      id: "live",
      status: "open",
      opened: "2026-03-02T14:00:00Z",
      closed: null,
      net: -900,
    };
    const d1 = evalDay("2026-03-02", [open]);
    expect(d1.max_loss_per_day.verdict).toBe("na");
    expect(d1.max_loss_per_trade.verdict).toBe("na");
  });

  it("resolves the day in the ACCOUNT timezone", () => {
    const t: Spec = {
      id: "t1",
      opened: "2026-03-02T02:00:00Z",
      closed: "2026-03-02T02:00:00Z",
      net: -500,
    };
    // 02:00 UTC is still the previous evening in New York.
    const ny = evalDay("2026-03-01", [t], LIMITS, "America/New_York");
    expect(ny.max_loss_per_day.verdict).toBe("fail");
    expect(evalDay("2026-03-02", [t], LIMITS, "America/New_York").max_loss_per_day.reason).toBe(
      "no_trades",
    );
  });
});

describe("the no-trade day", () => {
  it("is not applicable, and explicitly NOT a pass", () => {
    const d = evalDay("2026-03-02", []);
    for (const r of Object.values(d)) {
      expect(r.verdict).toBe("na");
      expect(r.verdict).not.toBe("pass");
      expect(r.reason).toBe(r.key.startsWith("max_loss") ? "no_trades" : "no_trades");
    }
  });

  it("ignores planned and missed positions — they are not executed discipline", () => {
    const d = evalDay("2026-03-02", [
      { id: "p", status: "planned", opened: "2026-03-02T14:00:00Z", playbook: false, stop: false },
      { id: "m", status: "missed", opened: "2026-03-02T14:00:00Z", playbook: false, stop: false },
    ]);
    expect(d.playbook_linked.verdict).toBe("na");
    expect(d.stop_loss_set.verdict).toBe("na");
    expect(d.playbook_linked.verdict).not.toBe("fail");
  });
});

describe("unpriced trades", () => {
  const day = "2026-03-02";
  const at = (id: string, net: number | null): Spec => ({
    id,
    opened: `${day}T14:00:00Z`,
    closed: `${day}T18:00:00Z`,
    net,
  });

  it("makes the daily sum unknown rather than assuming zero", () => {
    const d = evalDay(day, [at("a", -100), at("b", null)]);
    expect(d.max_loss_per_day.verdict).toBe("na");
    expect(d.max_loss_per_day.reason).toBe("unpriced");
  });

  it("still fails the daily rule's SIBLING when a priced trade breaches per-trade", () => {
    // Per-trade is judged trade by trade, so an unknown sibling cannot un-breach
    // a known breach.
    const d = evalDay(day, [at("big", -250), at("unknown", null)]);
    expect(d.max_loss_per_trade.verdict).toBe("fail");
    expect(d.max_loss_per_trade.offenders).toEqual(["big"]);
    expect(d.max_loss_per_day.verdict).toBe("na");
  });

  it("is not applicable per-trade when no priced trade breached", () => {
    const d = evalDay(day, [at("small", -50), at("unknown", null)]);
    expect(d.max_loss_per_trade.verdict).toBe("na");
    expect(d.max_loss_per_trade.reason).toBe("unpriced");
  });

  it("never lets an unpriced day read as a pass", () => {
    const d = evalDay(day, [at("unknown", null)]);
    expect(d.max_loss_per_day.verdict).not.toBe("pass");
    expect(d.max_loss_per_trade.verdict).not.toBe("pass");
  });
});

describe("configuration", () => {
  it("is not applicable while no limit is set, even with trades", () => {
    const d = evalDay(
      "2026-03-02",
      [{ id: "t", opened: "2026-03-02T14:00:00Z", net: -9999 }],
      {},
    );
    expect(d.max_loss_per_day.verdict).toBe("na");
    expect(d.max_loss_per_day.reason).toBe("unconfigured");
    expect(d.max_loss_per_trade.reason).toBe("unconfigured");
    // The flag rules need no config and still evaluate.
    expect(d.playbook_linked.verdict).toBe("pass");
  });

  it("reads limits off the rule rows", () => {
    const cfg = configsFromRules([
      { auto_key: "max_loss_per_day", config: { pct: 4 } },
      { auto_key: null, config: {} },
    ]);
    expect(cfg.max_loss_per_day).toEqual({ pct: 4 });
    expect(cfg.max_loss_per_trade).toBeUndefined();
  });
});

describe("boundaries", () => {
  const day = "2026-03-02";
  const at = (id: string, net: number): Spec => ({
    id,
    opened: `${day}T14:00:00Z`,
    closed: `${day}T18:00:00Z`,
    net,
  });

  it("treats a day exactly at the limit as a breach", () => {
    // Inclusive, matching evaluateFtmo: hitting your limit IS hitting it.
    expect(evalDay(day, [at("a", -400)]).max_loss_per_day.verdict).toBe("fail");
    expect(evalDay(day, [at("a", -399.99)]).max_loss_per_day.verdict).toBe("pass");
  });

  it("treats a trade exactly at the per-trade limit as a breach", () => {
    expect(evalDay(day, [at("a", -200)]).max_loss_per_trade.verdict).toBe("fail");
  });

  it("never fails a loss rule on a profitable day", () => {
    const d = evalDay(day, [at("a", 900)]);
    expect(d.max_loss_per_day.verdict).toBe("pass");
    expect(d.max_loss_per_trade.verdict).toBe("pass");
  });

  it("tolerates a limit stored with the wrong sign", () => {
    const d = evalDay(day, [at("a", -500)], { max_loss_per_day: { pct: -4 } });
    expect(d.max_loss_per_day.verdict).toBe("fail");
  });

  it("names the offending trades", () => {
    const d = evalDay(day, [at("ok", -10), at("bad", -300), at("worse", -400)]);
    expect(d.max_loss_per_trade.offenders.sort()).toEqual(["bad", "worse"]);
    expect(d.max_loss_per_trade.observed).toBe(-400);
  });
});

describe("buildTradeDayIndex", () => {
  it("puts a multi-day trade in the open bucket and the close bucket only", () => {
    const idx = index([
      { id: "t", opened: "2026-03-02T14:00:00Z", closed: "2026-03-04T14:00:00Z", net: -10 },
    ]);
    expect(idx.byOpenDay.get("2026-03-02")?.map((t) => t.id)).toEqual(["t"]);
    expect(idx.byCloseDay.get("2026-03-04")?.map((t) => t.id)).toEqual(["t"]);
    expect(idx.byCloseDay.get("2026-03-02")).toBeUndefined();
    expect(idx.byOpenDay.get("2026-03-04")).toBeUndefined();
  });

  it("skips a position with no opened_at — it cannot be dated", () => {
    const row = mkRow({ id: "x", opened: "2026-03-02T14:00:00Z" });
    (row.stats as { opened_at: string | null }).opened_at = null;
    const idx = buildTradeDayIndex([row], () => "UTC");
    expect(idx.byOpenDay.size).toBe(0);
  });
});

describe("the closed set of auto rules", () => {
  /**
   * `AUTO_RULE_KEYS` carries a contract in its own header: *"The set is closed
   * and mirrors the DB CHECK. Adding one means writing an evaluator, so a key
   * with no evaluator must never be storable."*
   *
   * Nothing checked either half. `auto_key` is never chosen in the UI — it is
   * only seeded — so the constant had NO runtime consumer at all: it existed to
   * derive its own union type, and the promise it made was unenforced. These
   * three are that promise, written down as assertions.
   */
  const empty = () => buildTradeDayIndex([], () => "UTC");
  const verdicts = () => evaluateAutoRulesForDay("2026-03-02", empty(), {});

  it("has an evaluator for every key, and a key for every evaluator", () => {
    expect(Object.keys(verdicts()).sort()).toEqual([...AUTO_RULE_KEYS].sort());
  });

  it("labels each verdict with the key it answers for", () => {
    // The result is indexed by key downstream (`auto[rule.auto_key]`), so a
    // verdict carrying someone else's key would silently answer for the wrong
    // rule.
    for (const key of AUTO_RULE_KEYS) expect(verdicts()[key].key, key).toBe(key);
  });

  it("asks for a limit on the money rules and only on those", () => {
    expect([...AUTO_RULES_NEEDING_PCT].sort()).toEqual([
      "max_loss_per_day",
      "max_loss_per_trade",
      "max_loss_per_week",
      "risk_per_trade",
    ]);
    // With no config and no trades, a money rule cannot answer for want of a
    // limit; the flag rules cannot answer for want of trades. Two different
    // reasons, and the checklist shows each of them to the user.
    for (const key of AUTO_RULE_KEYS) {
      expect(verdicts()[key].reason, key).toBe(
        AUTO_RULES_NEEDING_PCT.has(key) ? "unconfigured" : "no_trades",
      );
    }
  });
});

describe("max loss per week", () => {
  const at = (id: string, day: string, net: number) => ({
    id,
    opened: `${day}T09:00:00Z`,
    closed: `${day}T15:00:00Z`,
    net,
  });

  // 6 % of 10 000 = -600.
  const MON = "2026-03-02";
  const TUE = "2026-03-03";
  const WED = "2026-03-04";
  const SUN = "2026-03-08";
  const NEXT_MON = "2026-03-09";

  it("sums the week SO FAR, so a mid-week day can already be over budget", () => {
    // The reason it is scored daily rather than on Sunday: Wednesday is the day
    // that can still tell you the week is spent.
    const specs = [at("a", MON, -300), at("b", TUE, -400)];
    expect(evalDay(TUE, specs).max_loss_per_week.verdict).toBe("fail");
    expect(evalDay(TUE, specs).max_loss_per_week.observed).toBe(-700);
  });

  it("passes while the running total is still inside the limit", () => {
    const specs = [at("a", MON, -300), at("b", TUE, -200)];
    expect(evalDay(TUE, specs).max_loss_per_week.verdict).toBe("pass");
  });

  it("keeps failing on the days after the breach — the budget stayed blown", () => {
    const specs = [at("a", MON, -700), at("b", WED, 100)];
    expect(evalDay(WED, specs).max_loss_per_week.verdict).toBe("fail");
  });

  it("does not reach back into the previous week", () => {
    // Monday starts a new budget. Carrying last week's loss over would make the
    // rule a rolling seven days, which is not what a weekly limit means.
    const specs = [at("a", SUN, -900), at("b", NEXT_MON, -100)];
    expect(evalDay(NEXT_MON, specs).max_loss_per_week.verdict).toBe("pass");
    expect(evalDay(SUN, specs).max_loss_per_week.verdict).toBe("fail");
  });

  it("is not scored when the week has no closed trade yet", () => {
    expect(evalDay(MON, []).max_loss_per_week.reason).toBe("no_trades");
  });

  it("is not scored when the equity basis is unknown", () => {
    // A configured limit with no balance to take a percentage of is a different
    // state from an unset limit, and says so.
    const d = evaluateAutoRulesForDay(
      TUE,
      index([at("a", MON, -900)]),
      LIMITS,
      () => null,
    );
    expect(d.max_loss_per_week.reason).toBe("no_equity");
    expect(d.max_loss_per_day.reason).toBe("no_equity");
  });

  it("reports the money the percentage worked out to", () => {
    const d = evalDay(TUE, [at("a", MON, -700)]);
    expect(d.max_loss_per_week.limit).toBe(-600);
  });
});

/**
 * The two rules about the size of the bet rather than the size of the loss.
 *
 * Every fixture below opens on 2026-03-02 with a stop 10 points away, point
 * value 1 and fx 1, so the risk in money is simply `qty × 10` and the percentage
 * is that over `equityAtEntry`.
 */
describe("risk taken at entry", () => {
  const DAY = "2026-03-02";
  const entry = (id: string, over: Partial<Spec> = {}): Spec => ({
    id,
    opened: `${DAY}T09:00:00Z`,
    closed: null,
    status: "open",
    equityAtEntry: 10_000,
    ...over,
  });

  const verdicts = (specs: Spec[], configs: AutoConfigs = {}) =>
    evaluateAutoRulesForDay(DAY, index(specs), configs);

  describe("risk_per_trade", () => {
    const limit1pct: AutoConfigs = { risk_per_trade: { pct: 1 } };

    it("passes a trade sized inside the limit, and reports the money at risk", () => {
      // 5 lots × 10 points = 50 at risk, 0.5 % of 10,000.
      const v = verdicts([entry("a", { qty: 5 })], limit1pct).risk_per_trade;
      expect(v.verdict).toBe("pass");
      expect(v.observed).toBe(50);
      expect(v.limit).toBe(100);
    });

    it("fails the trade that risked more than the ceiling, and names it", () => {
      const v = verdicts(
        [entry("small", { qty: 5 }), entry("big", { qty: 30 })],
        limit1pct,
      ).risk_per_trade;
      expect(v.verdict).toBe("fail");
      expect(v.offenders).toEqual(["big"]);
      expect(v.observed).toBe(300);
    });

    it("counts sizing exactly to the limit as the plan, not a breach", () => {
      const v = verdicts([entry("exact", { qty: 10 })], limit1pct).risk_per_trade;
      expect(v.verdict).toBe("pass");
    });

    it("grades the OPEN day — a loss closed later cannot hide the size", () => {
      // Opened on DAY, closed two days on: the risk was taken on DAY.
      const v = verdicts(
        [entry("held", { qty: 30, closed: "2026-03-04T15:00:00Z", status: "closed", net: 20 })],
        limit1pct,
      ).risk_per_trade;
      expect(v.verdict).toBe("fail");
      // The same trade passes the loss rule, because it made money.
      expect(
        evaluateAutoRulesForDay(
          "2026-03-04",
          index([entry("held", { qty: 30, closed: "2026-03-04T15:00:00Z", status: "closed", net: 20 })]),
          { max_loss_per_trade: { pct: 1 } },
          () => 10_000,
        ).max_loss_per_trade.verdict,
      ).toBe("pass");
    });

    it("says it is unscored rather than passing when it cannot measure", () => {
      expect(verdicts([entry("a")], {}).risk_per_trade.reason).toBe("unconfigured");
      // No stop: the risk has no size. Nothing breached, but nothing is known.
      expect(
        verdicts([entry("nostop", { stop: false })], limit1pct).risk_per_trade.reason,
      ).toBe("unpriced");
      // No entry-day equity: the denominator is missing.
      expect(
        verdicts([entry("noequity", { equityAtEntry: null })], limit1pct).risk_per_trade.reason,
      ).toBe("unpriced");
      expect(verdicts([], limit1pct).risk_per_trade.reason).toBe("no_trades");
    });

    it("a breach stands even beside a trade that cannot be measured", () => {
      const v = verdicts(
        [entry("big", { qty: 30 }), entry("unknown", { stop: false })],
        limit1pct,
      ).risk_per_trade;
      expect(v.verdict).toBe("fail");
      expect(v.offenders).toEqual(["big"]);
    });
  });

  describe("risk_matched_intent", () => {
    it("passes when the size matches what was chosen", () => {
      // 10 lots × 10 points = 100 = 1 % of 10,000, and "1%" was chosen.
      const v = verdicts([entry("a", { qty: 10, riskPct: "1%" })]).risk_matched_intent;
      expect(v.verdict).toBe("pass");
    });

    it("fails the trade that was sized past its own plan", () => {
      const v = verdicts([
        entry("planned", { qty: 10, riskPct: "1%" }),
        entry("oversized", { qty: 16, riskPct: "1%" }),
      ]).risk_matched_intent;
      expect(v.verdict).toBe("fail");
      expect(v.offenders).toEqual(["oversized"]);
    });

    it("forgives a rounding-sized difference, because lots are not continuous", () => {
      // 0.05 pp over — inside RISK_INTENT_TOLERANCE.
      const v = verdicts([entry("rounded", { qty: 10.5, riskPct: "1%" })]).risk_matched_intent;
      expect(v.verdict).toBe("pass");
    });

    it("is unscored, never a fail, when the intent or the risk is unknown", () => {
      // Nothing chosen from the dropdown.
      expect(verdicts([entry("nointent", { qty: 10 })]).risk_matched_intent.reason).toBe(
        "unpriced",
      );
      // Chosen, but the trade has no stop to measure against.
      expect(
        verdicts([entry("nostop", { stop: false, riskPct: "1%" })]).risk_matched_intent.reason,
      ).toBe("unpriced");
      expect(verdicts([]).risk_matched_intent.reason).toBe("no_trades");
    });

    it("judges what it can even when another trade cannot be judged", () => {
      const v = verdicts([
        entry("oversized", { qty: 16, riskPct: "1%" }),
        entry("unknown", { qty: 10 }),
      ]).risk_matched_intent;
      expect(v.verdict).toBe("fail");
      expect(v.offenders).toEqual(["oversized"]);
    });
  });
});
