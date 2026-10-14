import { describe, expect, it } from "vitest";
import { biasWasSet, buildTradeDayIndex, evaluateAutoRulesForDay } from "./auto-rules";
import { missingReview } from "../review-gaps";
import { topstepRulesResolver } from "../topstep";
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
  topstep_mode: true,
  topstep_plan: "50K",
  starting_balance: 50_000,
  topstep_payout_at: null,
  topstep_reset_at: null,
  risk_rule_pct: 100,
  risk_rule_min: 300,
  risk_rule_max: 300,
  topstep_personal_dll: 650,
  topstep_daily_target: 1500,
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
  evaluateAutoRulesForDay("2026-10-13", buildTradeDayIndex(rows, zoneOf, topstepRulesResolver([TS])));

const T2 = (r: Review = {}) =>
  trade("t2", "2026-10-13T07:24:39Z", -226.88, { playbook: null, mistake: ["Rani ulaz", "Bez Setupa"], psychology: ["Nestrpljiv", "FOMO"], ...r });
const T3 = (r: Review = {}) =>
  trade("t3", "2026-10-13T07:44:32Z", 263.56, { psychology: ["Ispoštovao rizik", "Vodio po planu", "Smiren"], ...r });

describe("phase Q review rules on 13.10.2026", () => {
  it("bias: both trades say 'Nisam odredio unapred' → broken on both", () => {
    const out = day([T2(), T3()]).htf_bias_set;
    expect(out.verdict).toBe("fail");
    expect(out.offenders.sort()).toEqual(["t2", "t3"]);
    expect(biasWasSet("gore")).toBe(true);
    expect(biasWasSet("nisam odredio unapred")).toBe(false);
    expect(biasWasSet(null)).toBe(false);
  });

  it("bias written on every trade passes", () => {
    expect(day([T2({ bias: "dole" }), T3({ bias: "nema ga" })]).htf_bias_set.verdict).toBe("pass");
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

  it("review complete fails a trade with no feeling, or no mistake and no A", () => {
    expect(day([T2(), T3({ psychology: [] })]).review_complete.offenders).toEqual(["t3"]);
    expect(day([T2(), T3({ mistake: [] })]).review_complete.offenders).toEqual(["t3"]);
    expect(day([T2(), T3({ mistake: [], grade: 5 })]).review_complete.verdict).toBe("pass");
  });

  it("a trade with no chart fails screenshots", () => {
    expect(day([T2(), T3({ images: 0 })]).screenshot_per_trade.offenders).toEqual(["t3"]);
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
