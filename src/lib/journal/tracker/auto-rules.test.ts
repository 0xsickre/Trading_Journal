import { describe, expect, it } from "vitest";
import { buildTradeDayIndex, evaluateAutoRulesForDay } from "./auto-rules";
import type { TradeRow } from "../types";
import { AUTO_RULE_KEYS } from "../tracker-types";

type Spec = {
  id: string;
  status?: string;
  opened: string; // ISO instant
  closed?: string | null;
  net?: number | null;
  playbook?: boolean;
  stop?: boolean;
  thesis?: boolean;
  /**
   * When the row was created. Defaults to `opened` — a plan entered the moment
   * it was written, the shape every older test here was written against.
   */
  created?: string;
};

function mkRow(s: Spec): TradeRow {
  return {
    id: s.id,
    account_id: "acc-1",
    trade_no: null,
    status: s.status ?? "closed",
    source: "manual",
    needs_review: false,
    created_at: s.created ?? s.opened,
    playbook_id: s.playbook === false ? null : "pb-1",
    stop_price: s.stop === false ? null : 90,
    thesis: s.thesis === false ? null : "Written before entry",
    stats: {
      position_id: s.id,
      avg_entry: 100,
      avg_exit: null,
      entry_qty: 1,
      exit_qty: 1,
      gross_pl: s.net ?? 0,
      net_pl: s.net === undefined ? 0 : s.net,
      total_fees: 0,
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

const evalDay = (day: string, specs: Spec[], tz = "UTC") => evaluateAutoRulesForDay(day, index(specs, tz));

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
    // Not a Topstep account, so not graded (H2) — but the trade is THERE on
    // the close day, and absent on the open day below.
    const d3 = evalDay("2026-03-04", [swing]);
    expect(d3.max_loss_per_day.reason).toBe("no_topstep_trades");
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
      playbook: false,
    };
    // 02:00 UTC is still the previous evening in New York.
    const ny = evalDay("2026-03-01", [t], "America/New_York");
    expect(ny.playbook_linked.verdict).toBe("fail");
    expect(evalDay("2026-03-02", [t], "America/New_York").playbook_linked.reason).toBe(
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
      expect(r.reason).toBe("no_trades");
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
  const verdicts = () => evaluateAutoRulesForDay("2026-03-02", empty());

  it("has an evaluator for every key, and a key for every evaluator", () => {
    expect(Object.keys(verdicts()).sort()).toEqual([...AUTO_RULE_KEYS].sort());
  });

  it("labels each verdict with the key it answers for", () => {
    // The result is indexed by key downstream (`auto[rule.auto_key]`), so a
    // verdict carrying someone else's key would silently answer for the wrong
    // rule.
    for (const key of AUTO_RULE_KEYS) expect(verdicts()[key].key, key).toBe(key);
  });

  it("has no rule that counts trades or losses in a row (30.09.2026)", () => {
    expect(AUTO_RULE_KEYS).not.toContain("max_trades_per_day");
    expect(AUTO_RULE_KEYS).not.toContain("stop_after_losses");
  });

  it("with no trades, every rule says so", () => {
    for (const key of AUTO_RULE_KEYS) expect(verdicts()[key].reason, key).toBe("no_trades");
  });
});

describe("thesis_written grades only trades planned before entry", () => {
  // `/trades/log` and the TopstepX import create a trade AFTER its fills, so
  // its seal is stamped at the moment of writing — after the close. There was
  // no plan before the entry to hold a thesis, and failing the rule on it
  // grades the way the trade was recorded, not the trader.
  const OPENED = "2026-03-02T14:00:00Z";
  const CLOSED = "2026-03-02T14:20:00Z";
  const planFirst = (id: string, thesis: boolean): Spec => ({
    id,
    opened: OPENED,
    closed: CLOSED,
    created: "2026-03-02T13:30:00Z",
    thesis,
  });
  const loggedAfter = (id: string, thesis: boolean): Spec => ({
    id,
    opened: OPENED,
    closed: CLOSED,
    created: "2026-03-02T15:05:00Z",
    thesis,
  });

  it("does not grade a trade created after its entry — na, no_plans", () => {
    const out = evalDay("2026-03-02", [loggedAfter("log", false)]);
    expect(out.thesis_written.verdict).toBe("na");
    expect(out.thesis_written.reason).toBe("no_plans");
    expect(out.thesis_written.offenders).toEqual([]);
  });

  it("does not pass it either, even when the seal carries a thesis", () => {
    // Nothing was checked: a sentence sealed after the close is not a reason
    // that existed before the position.
    const out = evalDay("2026-03-02", [loggedAfter("log", true)]);
    expect(out.thesis_written.verdict).toBe("na");
    expect(out.thesis_written.reason).toBe("no_plans");
  });

  it("passes a plan-first trade with a thesis", () => {
    const out = evalDay("2026-03-02", [planFirst("plan", true)]);
    expect(out.thesis_written.verdict).toBe("pass");
  });

  it("fails a plan-first trade without one", () => {
    const out = evalDay("2026-03-02", [planFirst("plan", false)]);
    expect(out.thesis_written.verdict).toBe("fail");
    expect(out.thesis_written.offenders).toEqual(["plan"]);
  });

  it("grades only the plan-first trade on a day that has both", () => {
    const out = evalDay("2026-03-02", [planFirst("plan", true), loggedAfter("log", false)]);
    expect(out.thesis_written.verdict).toBe("pass");

    const bad = evalDay("2026-03-02", [planFirst("plan", false), loggedAfter("log", false)]);
    expect(bad.thesis_written.verdict).toBe("fail");
    expect(bad.thesis_written.offenders).toEqual(["plan"]);
  });

  it("grades a resting plan the import filled — it was created before the fill", () => {
    const filled: Spec = {
      id: "limit",
      opened: OPENED,
      closed: CLOSED,
      created: "2026-02-27T09:00:00Z",
      thesis: false,
    };
    expect(evalDay("2026-03-02", [filled]).thesis_written.verdict).toBe("fail");
  });

  it("counts a trade created at the instant of its entry as planned", () => {
    // Boundary: `created_at <= opened_at`, the same instant is not "after".
    const out = evalDay("2026-03-02", [{ ...planFirst("edge", true), created: OPENED }]);
    expect(out.thesis_written.verdict).toBe("pass");
  });

  it("does not grade a trade whose creation time cannot be read", () => {
    // Not knowing when the row was written is not a breach: na, not fail.
    const row = { ...mkRow(planFirst("odd", false)), created_at: "" } as TradeRow;
    const out = evaluateAutoRulesForDay(
      "2026-03-02",
      buildTradeDayIndex([row], () => "UTC"),
    );
    expect(out.thesis_written.verdict).toBe("na");
    expect(out.thesis_written.reason).toBe("no_plans");
  });

  it("leaves the other open-day rules grading the logged trade", () => {
    // Quick log fills stop and playbook itself; only the thesis rule is narrowed.
    const out = evalDay("2026-03-02", [loggedAfter("log", false)]);
    expect(out.stop_loss_set.verdict).toBe("pass");
    expect(out.playbook_linked.verdict).toBe("pass");
  });
});
