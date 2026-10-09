/**
 * Time stop from the book's own trades (phase W, decision W1-A, 09.10.2026).
 *
 * The question: "my winners get going within N minutes — so a trade that has
 * not got going by then should be cut before it reaches the stop". Two numbers
 * per trade answer it, both measured by `futures-trading` from the R2 candles:
 *
 * - `last_underwater_seconds` — seconds from the first entry to the end of the
 *   LAST moment the running P&L was below zero. On a winner that is the moment
 *   it went green for good (W1-A: in profit and never back below the entry).
 * - `time_underwater_pct` × `duration_seconds` — how long a loser sat in the
 *   red before it was closed.
 *
 * The ladder is what keeps the average from misleading: it shows, for each N,
 * how many winners a cut at N would have killed next to how many losers were
 * still open at N. A loser still open at N is the most a time stop could have
 * closed early — whether it was in the red at that minute is not stored, so
 * the column is an upper bound and is labelled that way.
 */

import type { RealizedTrade } from "./analytics";
import { EXACT_ZERO_RANGE, tradeOutcome, type BreakevenRange } from "./breakeven";
import { mean, median, percentile } from "./enriched-trade";
import { numberFieldValue as numField } from "./field-values";

/** Minutes the ladder is read at; 5 / 15 / 30 / 60 match the plan's time-stop choices. */
export const TIME_STOP_MINUTES = [1, 2, 3, 5, 10, 15, 30, 60] as const;

export type TimeStopRung = {
  minutes: number;
  /** Winners already green for good at N, % of measured winners. */
  winnersGreenPct: number | null;
  /** Losers still open at N, % of measured losers — the most a cut at N could have saved. */
  losersOpenPct: number | null;
};

export type TimeStopStats = {
  /** Winners with a measured `last_underwater_seconds`. */
  winners: number;
  /** Winners that never spent a second below the entry. */
  winnersNeverRed: number;
  medianToGreenSeconds: number | null;
  p75ToGreenSeconds: number | null;
  p90ToGreenSeconds: number | null;
  /** Losers with a duration and a measured `time_underwater_pct`. */
  losers: number;
  avgLoserRedSeconds: number | null;
  medianLoserRedSeconds: number | null;
  avgLoserSeconds: number | null;
  ladder: TimeStopRung[];
};

const pct = (n: number, of: number): number | null => (of > 0 ? (100 * n) / of : null);

export function computeTimeStop(
  trades: RealizedTrade[],
  range: BreakevenRange = EXACT_ZERO_RANGE,
  pnlOf: (t: RealizedTrade) => number = (t) => t.net,
): TimeStopStats {
  const toGreen: number[] = [];
  const loserRed: number[] = [];
  const loserDuration: number[] = [];

  for (const t of trades) {
    const outcome = tradeOutcome(t.row, pnlOf(t), range);
    if (outcome === "win") {
      const s = numField(t.row, "last_underwater_seconds");
      if (s != null && s >= 0) toGreen.push(s);
    } else if (outcome === "loss") {
      const secs = t.row.stats?.duration_seconds;
      const under = numField(t.row, "time_underwater_pct");
      if (secs == null || !Number.isFinite(secs) || secs < 0 || under == null) continue;
      loserDuration.push(secs);
      loserRed.push((under / 100) * secs);
    }
  }

  return {
    winners: toGreen.length,
    winnersNeverRed: toGreen.filter((s) => s === 0).length,
    medianToGreenSeconds: median(toGreen),
    p75ToGreenSeconds: percentile(toGreen, 0.75),
    p90ToGreenSeconds: percentile(toGreen, 0.9),
    losers: loserDuration.length,
    avgLoserRedSeconds: mean(loserRed),
    medianLoserRedSeconds: median(loserRed),
    avgLoserSeconds: mean(loserDuration),
    ladder: TIME_STOP_MINUTES.map((minutes) => {
      const n = minutes * 60;
      return {
        minutes,
        winnersGreenPct: pct(toGreen.filter((s) => s <= n).length, toGreen.length),
        losersOpenPct: pct(loserDuration.filter((s) => s > n).length, loserDuration.length),
      };
    }),
  };
}
