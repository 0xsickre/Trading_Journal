import type { TradeRow } from "./types";
import {
  computePlannedRewardR,
  parsePlannedRewardR,
} from "./plan-calculations";

export type ExitEfficiencyResult = {
  plannedRewardR: number;
  realizedR: number;
  ratio: number;
  pct: number;
};

export { parsePlannedRewardR } from "./plan-calculations";

/**
 * Minimum meaningful planned reward (R). A stored `planned_rr` below this is
 * treated as a data-entry error; without the floor, dividing realized R by a
 * near-zero planned reward makes exit-efficiency % explode.
 */
const MIN_PLANNED_REWARD_R = 0.1;

function numField(row: TradeRow, key: string): number | null {
  const v = row[key];
  return typeof v === "number" && !Number.isNaN(v) ? v : null;
}

/** Planned reward R from stored planned_rr or entry/stop/target prices. */
export function plannedRewardFromTrade(row: TradeRow): number | null {
  const parsed = parsePlannedRewardR(row.planned_rr as string | null);
  if (parsed != null) return parsed;

  return computePlannedRewardR({
    direction: (row.direction as string) ?? null,
    entry: numField(row, "entry_price"),
    stop: numField(row, "stop_price"),
    target: numField(row, "target_price"),
  });
}

export function exitEfficiencyFromTrade(
  row: TradeRow,
): ExitEfficiencyResult | null {
  const plannedRewardR = plannedRewardFromTrade(row);
  const realizedR = row.stats?.realized_r;
  if (
    plannedRewardR == null ||
    plannedRewardR < MIN_PLANNED_REWARD_R ||
    realizedR == null ||
    Number.isNaN(realizedR)
  ) {
    return null;
  }
  const ratio = realizedR / plannedRewardR;
  return {
    plannedRewardR,
    realizedR,
    ratio,
    pct: ratio * 100,
  };
}

export function fmtExitEfficiencyPct(pct: number | null | undefined): string {
  if (pct == null || Number.isNaN(pct)) return "—";
  return `${pct.toFixed(0)}%`;
}
