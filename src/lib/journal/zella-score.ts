/**
 * Composite score, 0–100.
 *
 * Weights and scales are transcribed from the clone spec §2.6. Two things the
 * spec flags about itself are handled explicitly rather than silently:
 *
 *   1. Interpolation inside a band (2.40–2.59 → 90–99) is not documented. We
 *      interpolate linearly and keep the bands as data, so recalibrating means
 *      editing a table rather than rewriting a formula.
 *   2. The Max Drawdown component uses `maxPctZella` — drawdown over peak
 *      cumulative P&L — NOT the equity-based percentage shown in the UI. The
 *      two have different denominators; feeding the honest one in here would
 *      produce a score that cannot be compared with TradeZella's.
 *
 * A component with no data (no drawdown yet, no losses yet) is dropped and the
 * remaining weights are renormalized, so an young track record is not punished
 * for arithmetic that has nothing to divide by.
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
 * Score a value against a band table, interpolating linearly within the band
 * it lands in.
 */
export function scoreFromBands(
  value: number | null,
  bands: ScoreBand[],
): number | null {
  if (value == null || Number.isNaN(value)) return null;

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
  profitFactor: number | null;
  avgWinLossRatio: number | null;
  /** Zella-base drawdown percentage — NOT the equity-based one. */
  maxDrawdownPctZella: number | null;
  winPct: number | null;
  recoveryFactor: number | null;
  /** Already 0–100 from `consistencyScore`. */
  consistencyScore: number | null;
  /** Optional seventh component; TradeZella has no equivalent. */
  processAdherencePct?: number | null;
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

export type ZellaScore = {
  score: number | null;
  components: ScoreComponent[];
  /** Sum of weights that actually contributed. */
  coverage: number;
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

export function computeZellaScore(inputs: ScoreInputs): ZellaScore {
  const drawdownScore =
    inputs.maxDrawdownPctZella == null
      ? null
      : Math.max(0, Math.min(100, 100 - inputs.maxDrawdownPctZella));

  const winScore =
    inputs.winPct == null
      ? null
      : Math.min(100, (inputs.winPct / WIN_PCT_TOP_THRESHOLD) * 100);

  const components: ScoreComponent[] = [
    {
      key: "profitFactor",
      label: "Profit factor",
      weight: BASE_WEIGHTS.profitFactor,
      value: inputs.profitFactor,
      score: scoreFromBands(inputs.profitFactor, RATIO_BANDS),
      counted: false,
    },
    {
      key: "avgWinLoss",
      label: "Avg win/loss",
      weight: BASE_WEIGHTS.avgWinLoss,
      value: inputs.avgWinLossRatio,
      score: scoreFromBands(inputs.avgWinLossRatio, RATIO_BANDS),
      counted: false,
    },
    {
      key: "maxDrawdown",
      label: "Max drawdown",
      weight: BASE_WEIGHTS.maxDrawdown,
      value: inputs.maxDrawdownPctZella,
      score: drawdownScore,
      counted: false,
    },
    {
      key: "winPct",
      label: "Win %",
      weight: BASE_WEIGHTS.winPct,
      value: inputs.winPct,
      score: winScore,
      counted: false,
    },
    {
      key: "recovery",
      label: "Recovery factor",
      weight: BASE_WEIGHTS.recovery,
      value: inputs.recoveryFactor,
      score: scoreFromBands(inputs.recoveryFactor, RECOVERY_BANDS),
      counted: false,
    },
    {
      key: "consistency",
      label: "Consistency",
      weight: BASE_WEIGHTS.consistency,
      value: inputs.consistencyScore,
      score: inputs.consistencyScore,
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
  for (const c of components) {
    if (c.score == null) continue;
    c.counted = true;
    weighted += c.score * c.weight;
    coverage += c.weight;
  }

  return {
    score: coverage > 0 ? weighted / coverage : null,
    components,
    coverage,
  };
}
