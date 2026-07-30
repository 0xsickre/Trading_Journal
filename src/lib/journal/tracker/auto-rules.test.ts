import { describe, expect, it } from "vitest";
import {
  buildTradeDayIndex,
  configsFromRules,
  evaluateAutoRulesForDay,
  type AutoConfigs,
} from "./auto-rules";
import type { TradeRow } from "../types";

type Spec = {
  id: string;
  status?: string;
  opened: string; // ISO instant
  closed?: string | null;
  net?: number | null;
  playbook?: boolean;
  stop?: boolean;
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
    stop_price: s.stop === false ? null : 90,
    stats: {
      position_id: s.id,
      avg_entry: 100,
      avg_exit: null,
      entry_qty: 1,
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
      tick_size: null,
      point_value_source: s.net === null ? "missing" : "snapshot",
    },
  } as unknown as TradeRow;
}

const index = (specs: Spec[], tz = "UTC") =>
  buildTradeDayIndex(specs.map(mkRow), () => tz);

const LIMITS: AutoConfigs = {
  max_loss_per_day: { amount: 400 },
  max_loss_per_trade: { amount: 200 },
};

const evalDay = (day: string, specs: Spec[], configs: AutoConfigs = LIMITS, tz = "UTC") =>
  evaluateAutoRulesForDay(day, index(specs, tz), configs);

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
      { auto_key: "max_loss_per_day", config: { amount: 400 } },
      { auto_key: null, config: {} },
    ]);
    expect(cfg.max_loss_per_day).toEqual({ amount: 400 });
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
    const d = evalDay(day, [at("a", -500)], { max_loss_per_day: { amount: -400 } });
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
