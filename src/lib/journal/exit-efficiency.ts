import { sealedNumber, sealedValue } from "./plan-snapshot";
import type { TradeRow } from "./types";
import {
  blendedPlannedRewardR,
  parsePlannedRewardR,
} from "./plan-calculations";
import { parseScaleOutLevels } from "./scale-out";

export type ExitEfficiencyResult = {
  plannedRewardR: number;
  realizedR: number;
  ratio: number;
  pct: number;
};

// Re-exported so callers reading exit efficiency can parse a stored planned_rr
// without also importing plan-calculations. Same function, one definition.
export { parsePlannedRewardR } from "./plan-calculations";

/**
 * Minimum meaningful planned reward (R). A stored `planned_rr` below this is
 * treated as a data-entry error; without the floor, dividing realized R by a
 * near-zero planned reward makes exit-efficiency % explode.
 */
const MIN_PLANNED_REWARD_R = 0.1;

/**
 * Planned reward R: the stored `planned_rr` when there is one, otherwise
 * derived from the entry / stop / target prices.
 *
 * Stored wins ON PURPOSE, and the reason matters. This is the baseline "Target
 * attainment" grades the exit against, so it has to be the plan as it stood
 * when the trade was taken. The trade form stops rewriting `planned_rr` once a
 * position leaves `planned` (see its submit handler), which makes the stored
 * value a genuine record rather than a mirror of whatever the price fields say
 * today. Preferring live prices here would undo that: editing a closed trade's
 * target would move its own grading baseline, and a trader could flatter their
 * discipline score by lowering a target after the fact.
 *
 * The price fallback covers rows that never captured a plan — imports, trades
 * saved before the target was filled in, and every trade the bot writes, since
 * the bot reports what the broker holds and never a plan figure.
 *
 * That fallback WEIGHS THE SCALE-OUT. Entry-to-target is the whole plan only
 * when the whole position leaves at one price; with pieces it is the furthest
 * price and therefore too generous, and this value is the denominator of Target
 * attainment, so a too-generous plan reads as a poor exit. Left uncorrected the
 * metric would mark you down for scaling out. `blendedPlannedRewardR` is the
 * same function for both shapes: with no levels it IS entry-to-target.
 */
export function plannedRewardFromTrade(row: TradeRow): number | null {
  const parsed = parsePlannedRewardR(row.planned_rr as string | null);
  if (parsed != null) return parsed;

  // The sealed plan, for the same reason the stored `planned_rr` wins over
  // live prices: this is the DENOMINATOR of Target attainment, so lowering a
  // target after the close must not raise the score.
  return blendedPlannedRewardR({
    direction: (row.direction as string) ?? null,
    entry: sealedNumber(row, "entry_price"),
    stop: sealedNumber(row, "stop_price"),
    target: sealedNumber(row, "target_price"),
    levels: parseScaleOutLevels(sealedValue(row, "scale_out_levels")),
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
