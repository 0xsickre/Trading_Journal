import { describe, expect, it } from "vitest";
import {
  afterExitR,
  cellR,
  costR,
  scenarioOf,
  scenarioTrade,
  summarizeScenarios,
  type ScenarioTrade,
} from "./scenario";
import type { TradeRow } from "./types";

const SL = [0.5, 0.75, 1, 1.25, 1.5, 2];
const TP = [1, 1.5, 2, 2.5, 3, 4, 5];

/** The document futures-trading writes (tools/scenario.py, v1), with a grid built by `cell`. */
function doc(over: Record<string, unknown> = {}, cell: (i: number, j: number) => number = () => -1) {
  return {
    v: 1,
    direction: "long",
    entry: 100,
    entry_at: "2026-09-29T14:00:10+00:00",
    stop: 90,
    risk_pts: 10,
    target: 120,
    target_r: 2,
    exit: 90,
    exit_at: "2026-09-29T14:05:00+00:00",
    exit_kind: "stop",
    horizon_end: "2026-09-29T20:10:00+00:00",
    horizon_close: 130,
    sl: SL,
    tp: TP,
    grid: SL.map((_, i) => TP.map((_, j) => cell(i, j))),
    minutes: SL.map(() => TP.map(() => null)),
    mfe_before_stop_r: 0.4,
    sl_for_target_r: 1.3,
    target_minutes: 55,
    after_exit: {
      windows: { "15": { fav: 12, adv: 2 }, "30": { fav: 25, adv: 2 }, "60": { fav: 31, adv: 2 }, eod: { fav: 40, adv: 2 } },
      target_minutes: 40,
      stop_first: null,
    },
    source: "r2",
    contract: "MNQZ6",
    ...over,
  };
}

function row(scenario: unknown, stats: Partial<NonNullable<TradeRow["stats"]>> = {}): TradeRow {
  return {
    id: "t",
    scenario,
    stats: { entry_qty: 2, total_fees: 2.44, point_value: 2, fx_rate: 1, realized_r: -1, realized_r_net: -1.06, ...stats },
  } as unknown as TradeRow;
}

const trade = (d: unknown, stats = {}) => scenarioTrade(row(d, stats)) as ScenarioTrade;

describe("scenarioOf", () => {
  it("reads the document futures-trading writes", () => {
    const s = scenarioOf(row(doc()))!;
    expect(s.exitKind).toBe("stop");
    expect(s.grid).toHaveLength(6);
    expect(s.afterExit.windows["30"]).toEqual({ fav: 25, adv: 2 });
    expect(s.slForTargetR).toBe(1.3);
  });

  it("reads v2 (phase S: a target fills a tick through, a stop costs a tick) in the same shape as v1", () => {
    const s = scenarioOf(row(doc({ v: 2 }, (i, j) => (j === 0 ? -1.025 : TP[j]))))!;
    expect(s.grid[0][0]).toBe(-1.025);
    expect(s.grid[0][1]).toBe(1.5);
  });

  it("refuses another version, a missing cell or no risk — never half a scenario", () => {
    expect(scenarioOf(row(null))).toBeNull();
    expect(scenarioOf(row(doc({ v: 3 })))).toBeNull();
    const holed = doc();
    (holed.grid as number[][])[2][3] = null as unknown as number;
    expect(scenarioOf(row(holed))).toBeNull();
    expect(scenarioOf(row(doc({ risk_pts: 0 })))).toBeNull();
  });
});

describe("the grid in R of each variant, net of the commission", () => {
  it("charges the round turn per contract, larger in R for a tighter stop", () => {
    // $1.22 round turn per contract; 10-point stop at $2 a point = $20 of risk per contract.
    const t = trade(doc());
    expect(costR(t, 1)).toBeCloseTo(1.22 / 20);
    expect(costR(t, 0.5)).toBeCloseTo(1.22 / 10);
    expect(cellR(t, 2, 0, false)).toBe(-1);
    expect(cellR(t, 2, 0, true)).toBeCloseTo(-1 - 1.22 / 20);
  });

  it("averages cells, finds the best one and puts the real trades beside it", () => {
    // Trade A: every target up to 3R hit on the real stop; trade B: stopped everywhere.
    const a = trade(doc({}, (i, j) => (i === 2 && TP[j] <= 3 ? TP[j] : -1)), { realized_r: 2, realized_r_net: 1.9 });
    const b = trade(doc());
    const sum = summarizeScenarios([a, b], false)!;
    expect(sum.n).toBe(2);
    expect(sum.cells[2][4].meanR).toBe(1); // (3 + −1) / 2
    expect(sum.cells[2][4].hitRate).toBe(0.5);
    expect(sum.best).toEqual({ i: 2, j: 4, meanR: 1 });
    expect(sum.actualMeanR).toBe(0.5); // (2 + −1) / 2, gross
    expect(sum.realRow).toBe(2);
  });

  it("does not average grids of different shapes", () => {
    const other = trade(doc({ sl: [1], tp: [2], grid: [[2]], minutes: [[null]] }));
    expect(summarizeScenarios([trade(doc()), other])).toBeNull();
    expect(summarizeScenarios([])).toBeNull();
  });
});

describe("after the exit and after the stop", () => {
  it("counts a stop that the planned target followed", () => {
    const hit = trade(doc());
    const missed = trade(doc({ after_exit: { windows: {}, target_minutes: null, stop_first: null } }));
    const sum = summarizeScenarios([hit, missed])!;
    expect(sum.exits.stop).toBe(2);
    expect(sum.afterStop).toEqual({ n: 2, targetAfter: 1, medianMinutes: 40 });
  });

  it("measures how far a target exit ran on, in R", () => {
    const tp = trade(doc({ exit_kind: "target", exit: 120 }));
    const sum = summarizeScenarios([tp])!;
    expect(sum.afterTarget).toEqual({ n: 1, continuedOneR: 1, medianFavEodR: 4 });
    expect(afterExitR(tp.scenario)["15"]).toEqual({ fav: 1.2, adv: 0.2 });
  });

  it("tells a hand exit that the target would have come from one the stop would have taken", () => {
    const would = trade(doc({ exit_kind: "other", after_exit: { windows: {}, target_minutes: 20, stop_first: false } }));
    const saved = trade(doc({ exit_kind: "other", after_exit: { windows: {}, target_minutes: null, stop_first: true } }));
    expect(summarizeScenarios([would, saved])!.afterHand).toEqual({ n: 2, wouldHitTarget: 1, stopFirst: 1 });
  });

  it("gives the stop that would have lived to the target", () => {
    const sum = summarizeScenarios([trade(doc()), trade(doc({ sl_for_target_r: null }))])!;
    expect(sum.slForTarget).toMatchObject({ withTarget: 2, reached: 1, medianR: 1.3 });
  });
});
