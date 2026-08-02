/**
 * Sickre Score — composite, 0–100.
 *
 * Weights and band scales are transcribed from the TradeZella clone spec §2.6
 * so the number stays comparable with the tool it is measured against, but the
 * score is this journal's own: it carries a seventh component (process
 * adherence) that TradeZella has no equivalent for.
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
 * any other.
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

/** Win % that scores 100. The spec's documented default. */
export const WIN_PCT_TOP_THRESHOLD = 60;

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
  winPct: number | null;
  recoveryFactor: number | null;
  /** Already 0–100 from `consistencyScore`. */
  consistencyScore: number | null;
  /** Optional seventh component; TradeZella has no equivalent. */
  processAdherencePct?: number | null;
  /**
   * How many trades are behind the numbers above.
   *
   * Required, and required for a reason. Three of the inputs answer `0` for an
   * empty book because zero is the honest value of the STATISTIC — a book with
   * no trades has drawn down no money, won no trades and has no variance. But
   * zero evidence is not zero performance, and the score has to tell those
   * apart: `100 - 0 = 100` scored a brand-new account as flawless risk
   * management on the strength of never having traded, which then dragged a
   * whole composite up on nothing.
   *
   * `profitFactor`, `avgWinLossRatio` and `recoveryFactor` already answer null
   * on an empty book and drop themselves. These three cannot, because their
   * zero is indistinguishable from a real one — so the count comes in beside
   * them and this module does the distinguishing.
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
   * Needed because the total is not a constant: it is 100 without the process
   * component and 115 with it. A display that assumes 100 reads a partial
   * 100-of-115 score as fully covered — which is exactly what the card did
   * before the seventh component existed.
   */
  maxCoverage: number;
};

const BASE_WEIGHTS = {
  profitFactor: 25,
  avgWinLoss: 20,
  maxDrawdown: 20,
  winPct: 15,
  recovery: 10,
  consistency: 10,
} as const;

/** Weight for the process component when it is supplied. */
export const PROCESS_ADHERENCE_WEIGHT = 15;

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
  // empty book `100 - 0 = 100`, and on a single winning trade four separate
  // components sat at their maximum, every one of them an artifact of n=1.
  const enoughTrades = inputs.sample.trades >= MIN_SAMPLE;
  const enoughDecided = inputs.sample.decided >= MIN_SAMPLE;

  const gate = <T>(value: T | null, ok: boolean): T | null => (ok ? value : null);

  const profitFactor = gate(inputs.profitFactor, enoughDecided);
  const winLossRatio = gate(inputs.avgWinLossRatio, enoughDecided);
  const winPct = gate(inputs.winPct, enoughDecided);
  const drawdownPct = gate(inputs.maxDrawdownPctOfPeakPnl, enoughTrades);
  const recovery = gate(inputs.recoveryFactor, enoughTrades);
  const consistency = gate(inputs.consistencyScore, enoughTrades);

  const drawdownScore =
    drawdownPct == null
      ? null
      : Math.max(0, Math.min(100, 100 - drawdownPct));

  const winScore =
    winPct == null
      ? null
      : Math.min(100, (winPct / WIN_PCT_TOP_THRESHOLD) * 100);

  const components: ScoreComponent[] = [
    {
      key: "profitFactor",
      label: "Profit factor",
      weight: BASE_WEIGHTS.profitFactor,
      value: profitFactor,
      score: scoreFromBands(profitFactor, RATIO_BANDS),
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
      key: "maxDrawdown",
      label: "Max drawdown",
      weight: BASE_WEIGHTS.maxDrawdown,
      value: drawdownPct,
      score: drawdownScore,
      counted: false,
    },
    {
      key: "winPct",
      label: "Win %",
      weight: BASE_WEIGHTS.winPct,
      value: winPct,
      score: winScore,
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
    {
      key: "consistency",
      label: "Consistency",
      weight: BASE_WEIGHTS.consistency,
      value: consistency,
      score: consistency,
      counted: false,
    },
  ];

  if (inputs.processAdherencePct != null) {
    components.push({
      key: "process",
      label: "Process adherence",
      weight: PROCESS_ADHERENCE_WEIGHT,
      value: inputs.processAdherencePct,
      score: Math.max(0, Math.min(100, inputs.processAdherencePct)),
      counted: false,
    });
  }

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
