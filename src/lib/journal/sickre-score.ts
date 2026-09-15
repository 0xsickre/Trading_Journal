/**
 * Sickre Score — composite, 0–100.
 *
 * The band TABLES are still transcribed from the TradeZella clone spec §2.6.
 * The WEIGHTS are not, and stopped being so deliberately: that spec calibrates
 * an intraday scalp book, and this journal keeps a swing book on a prop
 * account — forty to seventy trades a year, a fixed target near three times
 * the stop. Three components measured the wrong thing under that design.
 *
 *   - **Win % is gone from the score entirely.** Its scale, `win% / 60 × 100`,
 *     encodes "higher is better". At a 3R target the mathematically expected
 *     win rate is 35–45 %, so a book trading exactly to plan scored about 67
 *     on the component — punished for its own design. Qullamaggie runs 25–35 %
 *     on purpose, and this score would have marked him down for the thing that
 *     makes the approach work. It stays on screen as a KPI tile and as a
 *     `/reports` metric, where it is a fact rather than a verdict.
 *   - **Avg win/loss fell to 5.** With a fixed target the ratio is settled by
 *     the design, not by execution: it will sit near 3 whatever happens. A
 *     constant with a weight of 20 was twenty points of nothing, and it
 *     half-duplicated profit factor besides.
 *   - **Max drawdown rose to 25.** On a funded account drawdown is not one of
 *     seven concerns, it is the only one that ends the game.
 *
 * And **process adherence rose to 30, the heaviest component**, because it is
 * the only one that does not depend on variance. Over forty trades a year the
 * outcome components are measured on a sample too thin to trust; follow rate
 * and tracker compliance measure behaviour, where n=40 already means
 * something. The README's own thesis is "P&L is the consequence, process is
 * the cause" — the old weights said the opposite, 15 of 115 to the cause and
 * 100 of 115 to the consequence.
 *
 * The seventh component is new: **FTMO headroom**, how close the account came
 * to the daily and overall limits. An account up 8 % that touched 4.5 % of a
 * 5 % floor was one bad day from the end, and nothing else here could see that.
 *
 * Two things the source spec flags about itself are handled explicitly rather
 * than silently:
 *
 *   1. Interpolation inside a band (2.40–2.59 → 90–99) is not documented. We
 *      interpolate linearly and keep the bands as data, so recalibrating means
 *      editing a table rather than rewriting a formula.
 *   2. The Max Drawdown component uses `maxPctOfPeakPnl` — drawdown over peak
 *      cumulative P&L — NOT the equity-based percentage shown in the UI. The
 *      two have different denominators; feeding the equity one in here would
 *      produce a score that cannot be compared across tools.
 *
 * A component with no data (no drawdown yet, no losses yet) is dropped and the
 * remaining weights are renormalized, so a young track record is not punished
 * for arithmetic that has nothing to divide by.
 *
 * That renormalization is only as good as the "no data" signal reaching it, and
 * for three components it did not. Drawdown, win % and consistency all answer
 * `0` for an empty book — correctly, as statistics — and `0` drawdown scores
 * **100**. An account with no trades at all therefore read 33/100 with "Max
 * drawdown: 100" on the card, a claim about risk management made on the
 * strength of having never taken a risk. `sample` closes that: the counts come
 * in with the values, and a component with nothing behind it is dropped like
 * any other. FTMO headroom is built to the same rule one level up: `ftmo.ts`
 * hands over `null`, never 100, for a challenge with no trades in its window.
 */

export type ScoreBand = { min: number; scoreMin: number; scoreMax: number };

/** Shared by Profit Factor and Avg Win/Loss — the spec gives them one table. */
export const RATIO_BANDS: ScoreBand[] = [
  { min: 2.6, scoreMin: 100, scoreMax: 100 },
  { min: 2.4, scoreMin: 90, scoreMax: 99 },
  { min: 2.2, scoreMin: 80, scoreMax: 89 },
  { min: 2.0, scoreMin: 70, scoreMax: 79 },
  { min: 1.9, scoreMin: 60, scoreMax: 69 },
  { min: 1.8, scoreMin: 50, scoreMax: 59 },
  { min: -Infinity, scoreMin: 20, scoreMax: 20 },
];

export const RECOVERY_BANDS: ScoreBand[] = [
  { min: 3.5, scoreMin: 100, scoreMax: 100 },
  { min: 3.0, scoreMin: 70, scoreMax: 89 },
  { min: 2.5, scoreMin: 60, scoreMax: 69 },
  { min: 2.0, scoreMin: 50, scoreMax: 59 },
  { min: 1.5, scoreMin: 30, scoreMax: 49 },
  { min: 1.0, scoreMin: 1, scoreMax: 29 },
  { min: -Infinity, scoreMin: 0, scoreMax: 0 },
];

/**
 * Sample thresholds.
 *
 * A composite score is the one number a trader will quote at themselves, so it
 * has the strictest evidence bar in the application — and until now it had
 * none, while every other module here has one: `DEFAULT_MIN_SAMPLE = 5` in the
 * report engine (*"a category with three trades and a 100 % win rate is not a
 * finding"*), `MIN_RATIO_DAYS = 5` in `risk-ratios`, a sample floor on all 31
 * insight rules. The score aggregated all of them and demanded nothing.
 *
 * Two tiers rather than one, because the two failure modes are different:
 *
 *   - **Below `MIN_SAMPLE` the number is noise, so there is no number.** One
 *     winning trade produced 100/100 — infinite profit factor, no drawdown to
 *     have had, a 100 % win rate and zero variance over a single sample. Four
 *     components at their maximum, every one of them an artifact of n=1.
 *   - **Below `RELIABLE_SAMPLE` the number is real but unstable**, so it is
 *     shown WITH its sample rather than withheld. A win rate over five decided
 *     trades carries a confidence interval about forty points wide; hiding the
 *     score until it narrows would leave a new account staring at a blank card
 *     for weeks, which is its own kind of dishonest. The report engine already
 *     settled this argument for rows — *sample size is carried on every row and
 *     never hidden* — and the score now answers it the same way.
 *
 * `MIN_SAMPLE` is deliberately the same 5 the rest of the codebase uses. One
 * number to remember, and one place to change it.
 */
export const MIN_SAMPLE = 5;
export const RELIABLE_SAMPLE = 30;

/**
 * Share of total weight that must be covered before a composite is a composite.
 *
 * The gate the empty-account report needed: with no trades but a tracker
 * history, exactly one of seven components had data, and the card presented
 * that single component under the heading "Sickre Score". A score built from
 * 15 of 115 weights is not a composite of anything — it is one metric wearing
 * another metric's name.
 *
 * It still holds after the rebalance, which is worth stating because the
 * rebalance made the components it guards much heavier. The two that can have
 * data on a book with no trades are process (30) and FTMO headroom (10): 40 of
 * 110 is 36 %, comfortably under the gate. Raising process to 30 did not buy a
 * trackerless account a score.
 */
export const MIN_COVERAGE_SHARE = 0.5;

/**
 * Score a value against a band table, interpolating linearly within the band
 * it lands in.
 */
export function scoreFromBands(
  value: number | null,
  bands: ScoreBand[],
): number | null {
  if (value == null || Number.isNaN(value)) return null;

  // A book with winners and no losses has an infinite profit factor. That is a
  // maximal result, not missing data: it belongs in the top band. Treating it
  // as null dropped the component and scored perfection BELOW mediocrity.
  if (value === Infinity) return bands[0]?.scoreMax ?? 100;
  if (value === -Infinity) return bands[bands.length - 1]?.scoreMin ?? 0;

  for (let i = 0; i < bands.length; i++) {
    const band = bands[i];
    if (value < band.min) continue;
    if (band.scoreMin === band.scoreMax) return band.scoreMin;

    // Upper edge of this band is the next band up's floor.
    const upper = i > 0 ? bands[i - 1].min : Number.POSITIVE_INFINITY;
    if (!Number.isFinite(upper) || !Number.isFinite(band.min)) {
      return band.scoreMax;
    }
    const t = (value - band.min) / (upper - band.min);
    return band.scoreMin + t * (band.scoreMax - band.scoreMin);
  }
  return bands[bands.length - 1].scoreMin;
}

export type ScoreInputs = {
  /** `Infinity` (no losses) scores the top band; `null` drops the component. */
  profitFactor: number | null;
  /**
   * Average winning MONEY over average losing money. `RATIO_BANDS` is
   * transcribed from a spec that defines this ratio in currency, so feeding it
   * an R-multiple ratio would score two different quantities against one table.
   */
  avgWinLossRatio: number | null;
  /** Drawdown over peak cumulative P&L — NOT the equity-based percentage. */
  maxDrawdownPctOfPeakPnl: number | null;
  recoveryFactor: number | null;
  /** Already 0–100 from `consistencyScore`. */
  consistencyScore: number | null;
  /** Optional; TradeZella has no equivalent. */
  processAdherencePct?: number | null;
  /**
   * Optional. Room left over from the closest approach to an enabled prop-firm
   * limit, 0–100, straight from `evaluateFtmo`'s `headroomPct`.
   *
   * Ungated by `sample`, like `processAdherencePct` and for the same reason:
   * the evidence rides with the producer. `ftmo.ts` answers `null` for a
   * challenge with nothing closed in its window, so there is no "measured
   * zero" here for this module to have to tell apart from an absence.
   *
   * It is also on a different clock from everything else in this type. The
   * other components are computed over whatever period the dashboard is
   * showing; a challenge window is fixed by its own reset and starting
   * balance, and a limit that was nearly touched does not stop having been
   * nearly touched because the reader switched to the last 30 days.
   */
  ftmoHeadroomPct?: number | null;
  /**
   * How many trades are behind the numbers above.
   *
   * Required, and required for a reason. Two of the inputs answer `0` for an
   * empty book because zero is the honest value of the STATISTIC — a book with
   * no trades has drawn down no money and has no variance. But
   * zero evidence is not zero performance, and the score has to tell those
   * apart: `100 - 0 = 100` scored a brand-new account as flawless risk
   * management on the strength of never having traded, which then dragged a
   * whole composite up on nothing.
   *
   * `profitFactor`, `avgWinLossRatio` and `recoveryFactor` already answer null
   * on an empty book and drop themselves. Drawdown and consistency cannot,
   * because their zero is indistinguishable from a real one — so the count
   * comes in beside them and this module does the distinguishing.
   */
  sample: {
    /** Closed trades in scope. */
    trades: number;
    /**
     * Decided trades — wins + losses, breakeven excluded. This is `winRate`'s
     * own denominator, so gating on it asks exactly the question the number
     * was computed from: a day of nothing but breakeven scratches is a 0 %
     * win rate over no decisions, which is not a 0 % win rate.
     */
    decided: number;
  };
};

export type ScoreComponent = {
  key: string;
  label: string;
  weight: number;
  value: number | null;
  score: number | null;
  /** False when the input was missing and the component was dropped. */
  counted: boolean;
};

/**
 * How much the number can be leaned on — carried WITH it, never inferred by the
 * caller from a trade count it would have to fetch separately.
 */
export type ScoreConfidence =
  /** No score at all. `tradesShort` is how many more trades until there is one. */
  | { level: "withheld"; reason: "sample" | "coverage"; tradesShort: number }
  /** Real, but thin enough that it will move a lot. Show `trades` beside it. */
  | { level: "provisional"; trades: number }
  | { level: "ok"; trades: number };

export type SickreScore = {
  /** Null while `confidence.level` is `withheld`. */
  score: number | null;
  components: ScoreComponent[];
  confidence: ScoreConfidence;
  /** Sum of weights that actually contributed. */
  coverage: number;
  /**
   * Sum of ALL weights in play, contributing or not.
   *
   * Needed because the total is not a constant: 70 for the trade-derived
   * components alone, 110 with both optional ones. A display that assumes 100
   * reads a partial score as fully covered — which is exactly what the card did
   * before the optional components existed.
   */
  maxCoverage: number;
};

const BASE_WEIGHTS = {
  maxDrawdown: 25,
  profitFactor: 20,
  consistency: 15,
  avgWinLoss: 5,
  recovery: 5,
} as const;

/**
 * Weight for the process component when it is supplied — the heaviest in the
 * score, and the only one that is not a measurement of outcome.
 */
export const PROCESS_ADHERENCE_WEIGHT = 30;

/** Weight for the prop-firm headroom component when it is supplied. */
export const FTMO_HEADROOM_WEIGHT = 10;

export function computeSickreScore(inputs: ScoreInputs): SickreScore {
  // Evidence gate, before anything is scored. Every component derived from
  // trades is held to `MIN_SAMPLE`, each on ITS OWN denominator — the two are
  // not interchangeable. `trades` governs the path-dependent statistics
  // (drawdown is a walk over the sequence; consistency is its dispersion),
  // while `decided` governs the ones built from wins against losses. A book of
  // nothing but breakeven scratches has a path to measure and no decisions to
  // have won, and gating both on one count would answer one of them wrongly.
  //
  // A gated component reports `value: null` as well as `score: null`, so the
  // card shows "—" rather than a 0 or a 100 the reader would take for a
  // measurement. That is the whole bug this section exists to prevent: on an
  // empty book `100 - 0 = 100`, and on a single winning trade several separate
  // components sat at their maximum, every one of them an artifact of n=1.
  const enoughTrades = inputs.sample.trades >= MIN_SAMPLE;
  const enoughDecided = inputs.sample.decided >= MIN_SAMPLE;

  const gate = <T>(value: T | null, ok: boolean): T | null => (ok ? value : null);

  const profitFactor = gate(inputs.profitFactor, enoughDecided);
  const winLossRatio = gate(inputs.avgWinLossRatio, enoughDecided);
  const drawdownPct = gate(inputs.maxDrawdownPctOfPeakPnl, enoughTrades);
  const recovery = gate(inputs.recoveryFactor, enoughTrades);
  const consistency = gate(inputs.consistencyScore, enoughTrades);

  const drawdownScore =
    drawdownPct == null
      ? null
      : Math.max(0, Math.min(100, 100 - drawdownPct));

  const pct = (v: number | null | undefined): number | null =>
    v == null ? null : Math.max(0, Math.min(100, v));

  // HEAVIEST FIRST, INCLUDING THE OPTIONAL ONES, which is why they are built
  // in place and filtered rather than appended. The radar inherits this order
  // for its corners and its whole contract is that the same book draws the
  // same shape every time; a component that jumps to the end of the list when
  // it happens to have data would rotate the polygon on data availability.
  const slots: (ScoreComponent | null)[] = [
    inputs.processAdherencePct == null
      ? null
      : {
          key: "process",
          label: "Process adherence",
          weight: PROCESS_ADHERENCE_WEIGHT,
          value: inputs.processAdherencePct,
          score: pct(inputs.processAdherencePct),
          counted: false,
        },
    {
      key: "maxDrawdown",
      label: "Max drawdown",
      weight: BASE_WEIGHTS.maxDrawdown,
      value: drawdownPct,
      score: drawdownScore,
      counted: false,
    },
    {
      key: "profitFactor",
      label: "Profit factor",
      weight: BASE_WEIGHTS.profitFactor,
      value: profitFactor,
      score: scoreFromBands(profitFactor, RATIO_BANDS),
      counted: false,
    },
    {
      key: "consistency",
      label: "Consistency",
      weight: BASE_WEIGHTS.consistency,
      value: consistency,
      score: consistency,
      counted: false,
    },
    inputs.ftmoHeadroomPct == null
      ? null
      : {
          key: "ftmoHeadroom",
          label: "FTMO headroom",
          weight: FTMO_HEADROOM_WEIGHT,
          value: inputs.ftmoHeadroomPct,
          score: pct(inputs.ftmoHeadroomPct),
          counted: false,
        },
    {
      key: "avgWinLoss",
      label: "Avg win/loss",
      weight: BASE_WEIGHTS.avgWinLoss,
      value: winLossRatio,
      score: scoreFromBands(winLossRatio, RATIO_BANDS),
      counted: false,
    },
    {
      key: "recovery",
      label: "Recovery factor",
      weight: BASE_WEIGHTS.recovery,
      value: recovery,
      score: scoreFromBands(recovery, RECOVERY_BANDS),
      counted: false,
    },
  ];
  const components: ScoreComponent[] = slots.filter((c) => c != null);

  let weighted = 0;
  let coverage = 0;
  let maxCoverage = 0;
  for (const c of components) {
    maxCoverage += c.weight;
    if (c.score == null) continue;
    c.counted = true;
    weighted += c.score * c.weight;
    coverage += c.weight;
  }

  // Two independent reasons to withhold, reported separately because they tell
  // the trader different things.
  //
  // `sample` is "come back after more trades" and can be counted down to.
  // `coverage` is "what data you have does not add up to a composite" — the
  // empty-account case, where a tracker history alone covered 15 of 115 weights
  // and the card put the word "Sickre Score" above a single component.
  const trades = inputs.sample.trades;
  const confidence: ScoreConfidence =
    trades < MIN_SAMPLE
      ? { level: "withheld", reason: "sample", tradesShort: MIN_SAMPLE - trades }
      : coverage < maxCoverage * MIN_COVERAGE_SHARE
        ? { level: "withheld", reason: "coverage", tradesShort: 0 }
        : trades < RELIABLE_SAMPLE
          ? { level: "provisional", trades }
          : { level: "ok", trades };

  return {
    score:
      confidence.level === "withheld" || coverage === 0
        ? null
        : weighted / coverage,
    components,
    confidence,
    coverage,
    maxCoverage,
  };
}
