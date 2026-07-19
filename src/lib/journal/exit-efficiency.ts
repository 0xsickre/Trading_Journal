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

/** @deprecated Use exitEfficiencyFromTrade — kept for imports; measures target attainment. */
export const targetAttainmentFromTrade = exitEfficiencyFromTrade;

export const fmtTargetAttainmentPct = fmtExitEfficiencyPct;
