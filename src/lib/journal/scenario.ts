/**
 * What would have happened — the SL × TP grid, the price after the exit and
 * after the stop (phase L, decisions L1–L4, 30.09.2026).
 *
 * futures-trading measures every closed futures trade with a stop from the
 * exchange's own candles once its Topstep day is over, and writes the result
 * into `tj_positions.scenario`. The journal only reads it. Pure: the trade card,
 * the reports panel and the mentor pack share it.
 *
 * THE GRID. From the trade's average entry, at the moment of its first entry
 * fill: had the whole position carried a stop k × the real one (k in `sl`) and a
 * target t × that stop (t in `tp`), what came first by the end of the Topstep
 * day — the target (+t), the stop (−1, and a tick more since v2) or neither (the price at 15:10 CT). Every
 * cell is in R OF ITS OWN VARIANT (decision L3: the same money at risk, so a
 * wider stop is fewer contracts). Measured gross; `net` takes the round-turn
 * commission off per contract, which in R is larger for a tighter stop — the
 * cost a small stop really carries.
 *
 * FILLS AS AN EXCHANGE MAKES THEM (phase S, v2, 30.09.2026). The target is a
 * limit: it counts only once price trades a tick through it — a touch is not a
 * fill. The stop is a stop-market: a touch triggers it and it costs a tick of
 * slippage, so a stopped cell is −(1 + tick ÷ that variant's R). A v1 document
 * (touch fills, a stop at exactly −1) is re-measured by futures-trading.
 *
 * A grid is a hypothesis per trade and a finding only over many: a group under
 * `SCENARIO_MIN_SAMPLE` trades is marked, never hidden.
 */
import type { TradeRow } from "./types";

/** Below this many trades a group's best cell is a hypothesis, not a finding — the book-wide 30. */
export const SCENARIO_MIN_SAMPLE = 30;

export type ExitKind = "stop" | "target" | "other";
export const AFTER_EXIT_WINDOWS = ["15", "30", "60", "eod"] as const;
export type AfterExitWindow = (typeof AFTER_EXIT_WINDOWS)[number];
/** Points from the exit price: furthest with the trade (`fav`) and against it (`adv`). */
export type Excursion = { fav: number; adv: number };

export type TradeScenario = {
  direction: "long" | "short";
  entry: number;
  entryAt: string;
  stop: number;
  riskPts: number;
  target: number | null;
  targetR: number | null;
  exit: number;
  exitAt: string;
  exitKind: ExitKind;
  horizonEnd: string;
  horizonClose: number;
  /** SL multipliers of the real stop (rows) and targets in R of each variant (columns). */
  sl: number[];
  tp: number[];
  /** Gross R of each cell, in R of its own variant. */
  grid: number[][];
  /** Minutes from the entry to the cell's outcome; null = ran to the end of the day. */
  minutes: (number | null)[][];
  /** Furthest the trade went in its favour before the real stop (or the day's end), in R. */
  mfeBeforeStopR: number;
  /** Smallest stop (R) that would have lived to the planned target; null when the target never came. */
  slForTargetR: number | null;
  /** Minutes from the entry to the planned target's first fill (a tick through); null when it never came. */
  targetMinutes: number | null;
  afterExit: {
    windows: Record<AfterExitWindow, Excursion | null>;
    /** Minutes from the exit to the planned target (after a stop or a hand exit); null when it never came. */
    targetMinutes: number | null;
    /** A hand exit only: had it been held, would the old stop have come first. */
    stopFirst: boolean | null;
  };
  contract: string | null;
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v != null && !Array.isArray(v);

function numMatrix(v: unknown, rows: number, cols: number, nullable: boolean): (number | null)[][] | null {
  if (!Array.isArray(v) || v.length !== rows) return null;
  const out: (number | null)[][] = [];
  for (const r of v) {
    if (!Array.isArray(r) || r.length !== cols) return null;
    const row: (number | null)[] = [];
    for (const c of r) {
      const n = num(c);
      if (n == null && !(nullable && c == null)) return null;
      row.push(n);
    }
    out.push(row);
  }
  return out;
}

function excursion(v: unknown): Excursion | null {
  if (!isObj(v)) return null;
  const fav = num(v.fav);
  const adv = num(v.adv);
  return fav == null || adv == null ? null : { fav, adv };
}

/**
 * The trade's scenario, or null — a trade not measured yet, measured by another
 * version, or a document that does not have the shape. Never half a scenario:
 * a grid with a missing cell would average a hole as a zero.
 */
export function scenarioOf(row: TradeRow): TradeScenario | null {
  const raw = (row as Record<string, unknown>).scenario;
  // v2 (phase S) has v1's shape; only how a fill is counted changed, so both read the same.
  if (!isObj(raw) || (raw.v !== 1 && raw.v !== 2)) return null;
  const sl = Array.isArray(raw.sl) ? raw.sl.map(num) : [];
  const tp = Array.isArray(raw.tp) ? raw.tp.map(num) : [];
  if (sl.length === 0 || tp.length === 0 || sl.some((x) => x == null) || tp.some((x) => x == null)) return null;
  const grid = numMatrix(raw.grid, sl.length, tp.length, false);
  const minutes = numMatrix(raw.minutes, sl.length, tp.length, true);
  const riskPts = num(raw.risk_pts);
  const entry = num(raw.entry);
  const exit = num(raw.exit);
  const mfe = num(raw.mfe_before_stop_r);
  if (!grid || !minutes || riskPts == null || !(riskPts > 0) || entry == null || exit == null || mfe == null) return null;
  const ae = isObj(raw.after_exit) ? raw.after_exit : {};
  const w = isObj(ae.windows) ? ae.windows : {};
  const kind = raw.exit_kind === "stop" ? "stop" : raw.exit_kind === "target" ? "target" : "other";
  return {
    direction: raw.direction === "short" ? "short" : "long",
    entry,
    entryAt: String(raw.entry_at ?? ""),
    stop: num(raw.stop) ?? entry,
    riskPts,
    target: num(raw.target),
    targetR: num(raw.target_r),
    exit,
    exitAt: String(raw.exit_at ?? ""),
    exitKind: kind,
    horizonEnd: String(raw.horizon_end ?? ""),
    horizonClose: num(raw.horizon_close) ?? exit,
    sl: sl as number[],
    tp: tp as number[],
    grid: grid as number[][],
    minutes,
    mfeBeforeStopR: mfe,
    slForTargetR: num(raw.sl_for_target_r),
    targetMinutes: num(raw.target_minutes),
    afterExit: {
      windows: Object.fromEntries(AFTER_EXIT_WINDOWS.map((k) => [k, excursion(w[k])])) as Record<
        AfterExitWindow,
        Excursion | null
      >,
      targetMinutes: num(ae.target_minutes),
      stopFirst: typeof ae.stop_first === "boolean" ? ae.stop_first : null,
    },
    contract: typeof raw.contract === "string" ? raw.contract : null,
  };
}

/** A measured trade as the aggregates read it. */
export type ScenarioTrade = {
  scenario: TradeScenario;
  /** Round-turn commission per contract in account currency, from the trade's own fees; null when unknown. */
  costPerContract: number | null;
  /** Money per point per contract, in account currency. */
  pointValue: number | null;
  /** The trade as it was actually managed: gross and net R. */
  actualR: number | null;
  actualRNet: number | null;
};

export function scenarioTrade(row: TradeRow): ScenarioTrade | null {
  const scenario = scenarioOf(row);
  if (!scenario) return null;
  const s = row.stats;
  const qty = s?.entry_qty ?? null;
  const fees = s?.total_fees ?? null;
  const pv = s?.point_value != null ? s.point_value * (s.fx_rate ?? 1) : null;
  return {
    scenario,
    costPerContract: qty != null && qty > 0 && fees != null ? fees / qty : null,
    pointValue: pv != null && pv > 0 ? pv : null,
    actualR: s?.realized_r ?? null,
    actualRNet: s?.realized_r_net ?? null,
  };
}

/** The commission of one variant in its own R: round turn ÷ (k × stop points × point value). */
export function costR(t: ScenarioTrade, k: number): number {
  if (t.costPerContract == null || t.pointValue == null) return 0;
  return t.costPerContract / (k * t.scenario.riskPts * t.pointValue);
}

/** One cell of one trade, gross or net. */
export function cellR(t: ScenarioTrade, i: number, j: number, net: boolean): number {
  const g = t.scenario.grid[i][j];
  return net ? g - costR(t, t.scenario.sl[i]) : g;
}

export type GridCell = {
  /** Mean R per trade in this cell. */
  meanR: number;
  /** Share of trades whose target came first (0–1). */
  hitRate: number;
  /** Median minutes to a target that came, or null. */
  medianMinutesToTarget: number | null;
};

export type ScenarioSummary = {
  n: number;
  sl: number[];
  tp: number[];
  net: boolean;
  cells: GridCell[][];
  /** The trades as they were really managed, same basis (gross or net). */
  actualMeanR: number | null;
  best: { i: number; j: number; meanR: number } | null;
  /** Row of the real stop (k = 1). */
  realRow: number;
  /** Median planned target in R, over the trades that had one. */
  plannedTargetR: number | null;
  exits: Record<ExitKind, number>;
  afterStop: { n: number; targetAfter: number; medianMinutes: number | null };
  afterTarget: { n: number; continuedOneR: number; medianFavEodR: number | null };
  afterHand: { n: number; wouldHitTarget: number; stopFirst: number };
  /** Median favourable / adverse move after the exit, in R of the trade, per window. */
  afterExit: Record<AfterExitWindow, { fav: number | null; adv: number | null; n: number }>;
  slForTarget: { withTarget: number; reached: number; medianR: number | null; p80R: number | null };
  mfeBeforeStop: { medianR: number | null; p75R: number | null };
};

function quantile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const idx = (s.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

const mean = (v: number[]): number | null => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);

/** True when every scenario shares the same SL rows and TP columns — a mixed set cannot be averaged cell by cell. */
function sameShape(ts: ScenarioTrade[]): boolean {
  const [a] = ts;
  return ts.every(
    (t) =>
      t.scenario.sl.length === a.scenario.sl.length &&
      t.scenario.tp.length === a.scenario.tp.length &&
      t.scenario.sl.every((x, i) => x === a.scenario.sl[i]) &&
      t.scenario.tp.every((x, i) => x === a.scenario.tp[i]),
  );
}

/** Everything the panel says about a set of measured trades; null for an empty set or mixed grids. */
export function summarizeScenarios(ts: ScenarioTrade[], net = true): ScenarioSummary | null {
  if (ts.length === 0 || !sameShape(ts)) return null;
  const { sl, tp } = ts[0].scenario;
  const cells: GridCell[][] = sl.map((_, i) =>
    tp.map((_, j) => {
      const rs = ts.map((t) => cellR(t, i, j, net));
      const hits = ts.filter((t) => t.scenario.grid[i][j] === tp[j]);
      const mins = hits.map((t) => t.scenario.minutes[i][j]).filter((m): m is number => m != null);
      return {
        meanR: mean(rs) ?? 0,
        hitRate: hits.length / ts.length,
        medianMinutesToTarget: quantile(mins, 0.5),
      };
    }),
  );
  let best: ScenarioSummary["best"] = null;
  cells.forEach((row, i) =>
    row.forEach((c, j) => {
      if (best == null || c.meanR > best.meanR) best = { i, j, meanR: c.meanR };
    }),
  );
  const actual = ts.map((t) => (net ? t.actualRNet : t.actualR)).filter((r): r is number => r != null);

  const exits: Record<ExitKind, number> = { stop: 0, target: 0, other: 0 };
  for (const t of ts) exits[t.scenario.exitKind]++;

  const stopped = ts.filter((t) => t.scenario.exitKind === "stop" && t.scenario.target != null);
  const stopMins = stopped.map((t) => t.scenario.afterExit.targetMinutes).filter((m): m is number => m != null);
  const tpd = ts.filter((t) => t.scenario.exitKind === "target");
  const favEodR = tpd
    .map((t) => t.scenario.afterExit.windows.eod)
    .map((e, idx) => (e ? e.fav / tpd[idx].scenario.riskPts : null))
    .filter((r): r is number => r != null);
  const hand = ts.filter((t) => t.scenario.exitKind === "other" && t.scenario.target != null);

  const afterExit = Object.fromEntries(
    AFTER_EXIT_WINDOWS.map((w) => {
      const xs = ts
        .map((t) => ({ e: t.scenario.afterExit.windows[w], r: t.scenario.riskPts }))
        .filter((x): x is { e: Excursion; r: number } => x.e != null);
      return [
        w,
        {
          fav: quantile(xs.map((x) => x.e.fav / x.r), 0.5),
          adv: quantile(xs.map((x) => x.e.adv / x.r), 0.5),
          n: xs.length,
        },
      ];
    }),
  ) as ScenarioSummary["afterExit"];

  const withTarget = ts.filter((t) => t.scenario.target != null);
  const needed = withTarget.map((t) => t.scenario.slForTargetR).filter((r): r is number => r != null);
  const planned = withTarget.map((t) => t.scenario.targetR).filter((r): r is number => r != null);
  const mfe = ts.map((t) => t.scenario.mfeBeforeStopR);

  return {
    n: ts.length,
    sl,
    tp,
    net,
    cells,
    actualMeanR: mean(actual),
    best,
    realRow: Math.max(0, sl.indexOf(1)),
    plannedTargetR: quantile(planned, 0.5),
    exits,
    afterStop: {
      n: stopped.length,
      targetAfter: stopMins.length,
      medianMinutes: quantile(stopMins, 0.5),
    },
    afterTarget: {
      n: tpd.length,
      continuedOneR: favEodR.filter((r) => r >= 1).length,
      medianFavEodR: quantile(favEodR, 0.5),
    },
    afterHand: {
      n: hand.length,
      wouldHitTarget: hand.filter((t) => t.scenario.afterExit.targetMinutes != null && t.scenario.afterExit.stopFirst === false).length,
      stopFirst: hand.filter((t) => t.scenario.afterExit.stopFirst === true).length,
    },
    afterExit,
    slForTarget: {
      withTarget: withTarget.length,
      reached: needed.length,
      medianR: quantile(needed, 0.5),
      p80R: quantile(needed, 0.8),
    },
    mfeBeforeStop: { medianR: quantile(mfe, 0.5), p75R: quantile(mfe, 0.75) },
  };
}

/** A trade's move after the exit in R, per window — for the trade card. */
export function afterExitR(s: TradeScenario): Record<AfterExitWindow, Excursion | null> {
  return Object.fromEntries(
    AFTER_EXIT_WINDOWS.map((w) => {
      const e = s.afterExit.windows[w];
      return [w, e ? { fav: e.fav / s.riskPts, adv: e.adv / s.riskPts } : null];
    }),
  ) as Record<AfterExitWindow, Excursion | null>;
}
