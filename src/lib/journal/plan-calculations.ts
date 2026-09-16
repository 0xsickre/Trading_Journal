/** Planned R:R and position size — shared by trade form and tests. */

/**
 * Whether a trade is short.
 *
 * The only direction predicate in the project. There used to be three
 * expressions with the same body — this one, `tradeDirectionMultiplier` in
 * `position-stats.ts` and a private `tradeDirection` in `entry-slippage.ts`.
 * Direction sets the SIGN of every result, so it is the last place three copies
 * may live: it takes one of them learning to recognise "SELL" while the other
 * two do not, and the same trade is a win on one screen and a loss on another.
 *
 * `startsWith` rather than equality: brokers and manual entry write "Short",
 * "short", "Short (swing)".
 */
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
    // The ordering guard above already establishes both signs: IEEE-754
    // subtraction of two unequal finite doubles is never 0, so `stop > entry`
    // makes `stop - entry` positive by construction. A second `> 0` test here
    // would be a branch no input can take — and this module is pinned at 100 %
    // statements precisely so unreachable code cannot accumulate unnoticed.
    if (isShortDirection(dir)) {
      if (!(stop > entry && target < entry)) return null;
      return (entry - target) / (stop - entry);
    }
    // long (or non-short)
    if (!(stop < entry && target > entry)) return null;
    return (target - entry) / (entry - stop);
  }

  const risk = Math.abs(entry - stop);
  if (risk <= 0) return null;
  const reward = Math.abs(target - entry);
  return reward > 0 ? reward / risk : null;
}

/**
 * Lots/units: (balance × risk%) / (stop distance × point value).
 *
 * `pointValue` is nullable and a null REFUSES to size, rather than standing in
 * a 1. A missing contract spec used to arrive here as a literal 1 — the same
 * fallback `tj_position_stats` deliberately dropped — and because 1 passes the
 * `> 0` guard the function returned a confident number instead of nothing. On
 * an ES trade that is a suggestion 50× too large, and the trade form writes the
 * suggestion into `position_size`. A sizing calculator has to be the last place
 * in the system that guesses.
 */
export function computePositionSize(params: {
  balance: number;
  riskPct: number | null;
  entry: number | null;
  stop: number | null;
  pointValue: number | null;
}): number | null {
  const { balance, riskPct, entry, stop, pointValue } = params;
  if (
    riskPct == null ||
    entry == null ||
    stop == null ||
    balance <= 0 ||
    pointValue == null ||
    pointValue <= 0
  ) {
    return null;
  }
  const stopDist = Math.abs(entry - stop);
  if (stopDist <= 0) return null;
  const riskAmount = computeRiskAmount({ balance, riskPct });
  if (riskAmount == null) return null;
  return riskAmount / (stopDist * pointValue);
}

/**
 * What "1 %" is actually worth, in account currency.
 *
 * Extracted from `computePositionSize`, which computed it inline and threw it
 * away — the sizing formula's first step is the number the trader most needs to
 * see. A percentage is an abstraction you can agree to without flinching; the
 * same risk written as money is the one that makes you check the stop again.
 *
 * Reads CURRENT equity, not the starting balance, for the same reason position
 * size does: risk is a share of what the account is worth now.
 *
 * Null rather than 0 on bad input, matching every other calculator here — a
 * refusal to answer must not render as a confident zero.
 */
export function computeRiskAmount(params: {
  balance: number;
  riskPct: number | null;
}): number | null {
  const { balance, riskPct } = params;
  if (riskPct == null || !Number.isFinite(balance) || balance <= 0) return null;
  return (balance * riskPct) / 100;
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
    // How much comes off on the way is part of the same decision as where you
    // are going — it appears with the target, not before there is one.
    case "scale_out_plan":
      return hasEntry && hasStop && hasTarget;
    default:
      return true;
  }
}

/**
 * The risk-% option that stands for a playbook's default.
 *
 * The field is a SELECT over the user's own `risk_pct` list, so a default of 1
 * has to be matched to whatever that list calls it — "1%", "1 %", "1.0%". Values
 * are compared as numbers through `parseRiskPct`, never as strings.
 *
 * Null when nothing matches, and the caller then offers nothing. Writing "1%"
 * into a select that has no such option would leave the control blank while the
 * form believed a risk was chosen — worse than leaving it empty, because the
 * blank looks answered.
 */
export function matchRiskOption(
  options: readonly { value: string }[],
  pct: number | null | undefined,
): string | null {
  if (pct == null) return null;
  return options.find((o) => parseRiskPct(o.value) === pct)?.value ?? null;
}

/**
 * Is the "Why this trade" group answerable yet?
 *
 * The same gate as `risk_pct` and `target_price`: entry and stop define the
 * trade, and until they exist there is nothing to write a thesis about.
 *
 * Its own function rather than three more cases in `riskPlanFieldVisible`,
 * because the group is gated ONCE as a whole. Routing it through the per-field
 * switch is how these three ended up on a blank form in the first place — that
 * switch answers `true` for any name it does not recognise, so a field added to
 * the group without a matching case fails open and shows up immediately.
 */
export function thesisGroupVisible(
  entry: number | null,
  stop: number | null,
): boolean {
  return entry != null && stop != null;
}

/**
 * Planned reward R for a plan that EXITS IN PIECES.
 *
 * THE ERROR THIS REPLACES. `computePlannedRewardR` measures one distance: entry
 * to target. That is the whole plan only when the whole position leaves at one
 * price. Scale out 30 % at 1R, 30 % at 2R and the rest at 3R and the plan is
 * worth 0.3x1 + 0.3x2 + 0.4x3 = 2.1R — not 3R. Reading the furthest level as
 * "the" planned reward overstates it, and because that number is the DENOMINATOR
 * of Target attainment, the overstatement lands as a low score. The metric would
 * have quietly punished scaling out, which is the opposite of what it is for.
 *
 * (Taking the NEAREST level instead is the same mistake mirrored: 1R here, and
 * an attainment score flattered rather than punished. There is no single level
 * that answers this; only the weighted plan does.)
 *
 * WHY IT LIVES HERE and not in the bot that reports the levels: R divides by the
 * PLANNED risk, and that convention is the journal's. A bot computing its own R
 * would be a second implementation of it, free to drift. The bot sends prices
 * and percentages — facts — and the arithmetic stays in one place.
 *
 * It is not a bot feature either. A hand-typed scale-out plan has always had the
 * same arithmetic and the same wrong answer; this fixes both at once.
 *
 * REFUSES RATHER THAN GUESSES, in three cases, each of which is a broken plan
 * rather than an absent one:
 *   - a level that cannot be expressed in R (priced on the wrong side of entry)
 *   - percentages summing above 100
 *   - a remainder left over with no target price to exit it at
 * Each answers null, which renders as an em dash. Blending around a broken level
 * would produce a number that looks like an answer.
 */
export function blendedPlannedRewardR(params: {
  direction: string | null;
  entry: number | null;
  stop: number | null;
  target: number | null;
  levels: readonly { pct: number; price: number }[];
}): number | null {
  const { direction, entry, stop, target, levels } = params;

  const finalR = computePlannedRewardR({ direction, entry, stop, target });

  // No pieces: the plan is one exit, and this is the original question.
  if (levels.length === 0) return finalR;

  let weighted = 0;
  let pctUsed = 0;

  for (const level of levels) {
    if (!(level.pct > 0)) return null;

    const levelR = computePlannedRewardR({ direction, entry, stop, target: level.price });
    if (levelR == null) return null;

    weighted += level.pct * levelR;
    pctUsed += level.pct;
  }

  if (pctUsed > 100) return null;

  const remainder = 100 - pctUsed;
  if (remainder > 0) {
    // The rest of the position has to leave somewhere, and only `target` says
    // where. Without it the plan is incomplete, not merely unstated.
    if (finalR == null) return null;
    weighted += remainder * finalR;
  }

  return weighted / 100;
}
