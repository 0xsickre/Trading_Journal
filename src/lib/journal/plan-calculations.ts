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

/**
 * Progressive Risk Plan UI: which price/risk fields to show.
 *
 * The size is the Topstep risk rule's (`computeTopstepRisk`), so it waits for
 * nothing but the entry and the stop — there is no "Risk %" to choose (H2).
 */
export function riskPlanFieldVisible(
  fieldName: string,
  entry: number | null,
  stop: number | null,
  target: number | null,
): boolean {
  const hasEntry = entry != null;
  const hasStop = stop != null;
  const hasTarget = target != null;

  switch (fieldName) {
    case "entry_price":
      return true;
    case "stop_price":
      return hasEntry;
    case "direction":
    case "target_price":
    case "position_size":
      return hasEntry && hasStop;
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
 * Is the "Why this trade" group answerable yet?
 *
 * The same gate as `target_price`: entry and stop define the
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

/**
 * Risk per trade on a Topstep account, in money: a share of the ROOM above the
 * Maximum Loss Limit, held between the plan's bounds, and never more than the
 * Daily Loss Limit still allows today.
 *
 * The trader's own rule (futures-trading `izlaz/Uputstvo_rizik.pdf`): 12.5 % of
 * the room, at least $60 and at most $300 on a 50K — scaled with the plan, so
 * three stops always fit inside the DLL. A percentage of the whole balance is
 * the wrong base on a prop account: 1 % of $150 000 is $1 500, more than a 50K
 * may lose in a day, while the account can really only lose what is above the
 * floor.
 *
 * The bounds apply in order: the floor of the range first, then the ceiling,
 * then today's DLL — a minimum that would break today's DLL is not a minimum
 * worth keeping. Null when there is no room: an account on its floor has
 * nothing to risk.
 */
export function computeTopstepRisk(params: {
  room: number;
  pct: number;
  min: number;
  max: number;
  dllLeft: number;
  /**
   * The room from which `min` holds (R3, 30.09.2026: `topstepMinRiskFromRoom`).
   * Under it the risk is the plain share of the room: a floor that stays put
   * while the room shrinks would spend a growing part of what is left.
   */
  minFromRoom: number;
}): { amount: number; threeStopsFitDll: boolean } | null {
  const { room, pct, min, max, dllLeft, minFromRoom } = params;
  if (!(room > 0) || !(dllLeft > 0)) return null;
  const floor = room >= minFromRoom ? min : 0;
  const amount = Math.min(Math.max(room * (pct / 100), floor), max, dllLeft, room);
  return { amount, threeStopsFitDll: 3 * amount <= dllLeft };
}

/**
 * Ticks a stop is assumed to slip, per contract (R4, 30.09.2026). A stop is a
 * market order once touched, and the budget is what the trader may lose, not
 * what the stop price says.
 */
export const STOP_SLIPPAGE_TICKS = 1;

/**
 * Whole contracts for a futures position: what the risk buys at this stop,
 * ROUNDED DOWN, with the round-turn commission and `STOP_SLIPPAGE_TICKS` of
 * slippage on the stop counted as part of the loss, and no more than the
 * account may hold. Without a tick size no slippage is added — the loss is the
 * stop and the commission, as before R4, rather than a guessed tick.
 *
 * `maxContracts` is in THIS contract's units: a micro's cap is ten times its
 * mini's (Topstep counts micros 10:1). The loss the trader actually takes on
 * the stop is returned beside the count, because a rounded-down position risks
 * less than the budget and that is the number to read before sending the order.
 *
 * Null when a price, the point value or the stop distance is missing: sizing
 * refuses rather than guesses.
 */
export function computeFuturesContracts(params: {
  riskAmount: number | null;
  entry: number | null;
  stop: number | null;
  pointValue: number | null;
  commissionPerSide: number;
  maxContracts: number | null;
  tickSize: number | null;
}): { contracts: number; perContract: number; risk: number; capped: boolean } | null {
  const { riskAmount, entry, stop, pointValue, commissionPerSide, maxContracts, tickSize } = params;
  if (riskAmount == null || entry == null || stop == null || pointValue == null || pointValue <= 0) {
    return null;
  }
  const dist = Math.abs(entry - stop);
  if (dist <= 0) return null;
  const slippage = tickSize != null && tickSize > 0 ? STOP_SLIPPAGE_TICKS * tickSize * pointValue : 0;
  const perContract = dist * pointValue + 2 * Math.max(0, commissionPerSide) + slippage;
  // A hair of tolerance so $250 / $125.00 is 2, not 1.9999999.
  const byRisk = Math.max(0, Math.floor(riskAmount / perContract + 1e-9));
  const capped = maxContracts != null && byRisk > maxContracts;
  const contracts = capped ? (maxContracts as number) : byRisk;
  return { contracts, perContract, risk: contracts * perContract, capped };
}

/** A price distance in ticks — what a platform's bracket asks for. Null without a tick size. */
export function ticksBetween(a: number | null, b: number | null, tickSize: number | null): number | null {
  if (a == null || b == null || tickSize == null || tickSize <= 0) return null;
  return Math.round(Math.abs(a - b) / tickSize);
}
