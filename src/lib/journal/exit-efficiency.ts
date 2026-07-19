import type { TradeRow } from "./types";

export type ExitEfficiencyResult = {
  plannedRewardR: number;
  realizedR: number;
  ratio: number;
  pct: number;
};

/** Parse reward multiple from planned_rr string (e.g. "1:3.00" → 3). */
export function parsePlannedRewardR(
  plannedRr: string | null | undefined,
): number | null {
  if (plannedRr == null || plannedRr === "") return null;
  const s = String(plannedRr).trim();
  const colon = s.match(/^1\s*:\s*([\d.]+)\+?$/i);
  if (colon) {
    const n = Number(colon[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function numField(row: TradeRow, key: string): number | null {
  const v = row[key];
  return typeof v === "number" && !Number.isNaN(v) ? v : null;
}

/** Planned reward R from stored planned_rr or entry/stop/target prices. */
export function plannedRewardFromTrade(row: TradeRow): number | null {
  const parsed = parsePlannedRewardR(row.planned_rr as string | null);
  if (parsed != null) return parsed;

  const entry = numField(row, "entry_price");
  const stop = numField(row, "stop_price");
  const target = numField(row, "target_price");
  if (entry == null || stop == null || target == null) return null;
  const risk = Math.abs(entry - stop);
  if (risk <= 0) return null;
  const reward = Math.abs(target - entry) / risk;
  return reward > 0 ? reward : null;
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
  const sign = pct > 0 ? "" : "";
  return `${sign}${pct.toFixed(0)}%`;
}
