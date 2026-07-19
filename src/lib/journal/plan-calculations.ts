/** Planned R:R and position size — shared by trade form and tests. */

export function isShortDirection(direction: string | null | undefined): boolean {
  return String(direction ?? "")
    .toLowerCase()
    .startsWith("short");
}

export type InferredDirection = "Long" | "Short";

/** Infer trade direction from planned entry vs stop (stop below entry = Long). */
export function inferDirectionFromPrices(
  entry: number | null,
  stop: number | null,
): InferredDirection | null {
  if (entry == null || stop == null || Number.isNaN(entry) || Number.isNaN(stop)) {
    return null;
  }
  if (stop < entry) return "Long";
  if (stop > entry) return "Short";
  return null;
}

/** Parse risk % from option value (e.g. "1%" → 1). */
export function parseRiskPct(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = Number(String(value).replace("%", "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Reward multiple (R) from planned prices.
 * Long: (target - entry) / (entry - stop)
 * Short: (entry - target) / (stop - entry)
 * Without direction: abs fallback when geometry is ambiguous.
 */
export function computePlannedRewardR(params: {
  direction: string | null;
  entry: number | null;
  stop: number | null;
  target: number | null;
}): number | null {
  const { direction, entry, stop, target } = params;
  if (
    entry == null ||
    stop == null ||
    target == null ||
    Number.isNaN(entry) ||
    Number.isNaN(stop) ||
    Number.isNaN(target)
  ) {
    return null;
  }

  const dir = String(direction ?? "").trim();
  if (dir) {
    if (isShortDirection(dir)) {
      if (!(stop > entry && target < entry)) return null;
      const risk = stop - entry;
      const reward = entry - target;
      return risk > 0 && reward > 0 ? reward / risk : null;
    }
    // long (or non-short)
    if (!(stop < entry && target > entry)) return null;
    const risk = entry - stop;
    const reward = target - entry;
    return risk > 0 && reward > 0 ? reward / risk : null;
  }

  const risk = Math.abs(entry - stop);
  if (risk <= 0) return null;
  const reward = Math.abs(target - entry);
  return reward > 0 ? reward / risk : null;
}

/** Lots/units: (balance × risk%) / (stop distance × point value). */
export function computePositionSize(params: {
  balance: number;
  riskPct: number | null;
  entry: number | null;
  stop: number | null;
  pointValue: number;
}): number | null {
  const { balance, riskPct, entry, stop, pointValue } = params;
  if (
    riskPct == null ||
    entry == null ||
    stop == null ||
    balance <= 0 ||
    pointValue <= 0
  ) {
    return null;
  }
  const stopDist = Math.abs(entry - stop);
  if (stopDist <= 0) return null;
  const riskAmount = (balance * riskPct) / 100;
  return riskAmount / (stopDist * pointValue);
}

/** Store/display reward multiple as plain decimal string (e.g. "2.45"). */
export function formatPlannedRewardR(r: number): string {
  return r.toFixed(2);
}

/** Parse stored planned_rr — supports "2.45" and legacy "1:3.00". */
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

/** Progressive Risk Plan UI: which price/risk fields to show. */
export function riskPlanFieldVisible(
  fieldName: string,
  entry: number | null,
  stop: number | null,
  target: number | null,
  riskPct: number | null,
): boolean {
  const hasEntry = entry != null;
  const hasStop = stop != null;
  const hasTarget = target != null;
  const hasRisk = riskPct != null;

  switch (fieldName) {
    case "entry_price":
      return true;
    case "stop_price":
      return hasEntry;
    case "direction":
      return hasEntry && hasStop;
    case "target_price":
    case "risk_pct":
      return hasEntry && hasStop;
    case "position_size":
      return hasEntry && hasStop && hasRisk;
    case "planned_rr":
      return hasEntry && hasStop && hasTarget;
    default:
      return true;
  }
}
