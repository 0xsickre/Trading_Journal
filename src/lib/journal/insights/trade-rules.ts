/**
 * Trade-level insight rules.
 *
 * Thresholds live in one block at the top: they are business judgement, not
 * arithmetic, and every one of them should be arguable without touching logic.
 *
 * Day-trading cadence (F5.3). The revenge window is minutes on the same
 * account, and the tilt rule reads the loss streak the trader was standing in
 * when they entered — the same count the `stop_after_losses` rule grades (L3).
 * The hold-time rule compares against the 75th percentile of your own winners.
 */

import { fmtMoney } from "../format";
import { formatDuration } from "../units";
import type { EnrichedTrade, InsightContext } from "./context";
import type { Insight, InsightRule } from "./types";

const T = {
  /** MFE (in R) above which a trade counts as "was meaningfully in profit". */
  WAS_GREEN_R: 0.5,
  /** MAE (in R) above which a trade counts as "was meaningfully offside". */
  WAS_RED_R: 0.5,
  /** Capture below this on a winner means most of the move was handed back. */
  GAVE_BACK_CAPTURE_PCT: 40,
  /** Profit exceeding drawdown by this multiple is a cleanly-held trade. */
  CLEAN_HOLD_MULTIPLE: 2,
  /** Minutes after a loss, on the same account, within which a re-entry counts as reactive. */
  REVENGE_WINDOW_MINUTES: 5,
  /** Losses in a row on one account and day after which the day should have ended (L3, 29.09.2026). */
  TILT_LOSSES: 2,
  /** Share of a trade's time underwater (%) from which it was "mostly underwater". */
  MOSTLY_UNDERWATER_PCT: 75,
} as const;

/**
 * Trades of history a rule needs before it may compare a trade against "your
 * own" anything. Named once: three rules used to spell the same 8 inline.
 */
const BASELINE_MIN = 8;

type Rule = InsightRule<InsightContext>;

const insight = (
  e: EnrichedTrade,
  partial: Omit<Insight, "subjectId" | "subjectLabel" | "level">,
): Insight => ({
  ...partial,
  level: "trade",
  subjectId: e.id,
  subjectLabel: e.label,
});

const r2 = (n: number) => n.toFixed(2);

export const drawdownExceedsProfit: Rule = {
  id: "drawdown_exceeds_profit",
  level: "trade",
  minSample: 0,
  description:
    "MAE larger than the realized profit — the R-multiple looks better than the trade was.",
  evaluate: (ctx) =>
    ctx.trades
      .filter(
        (e) =>
          e.excursion.maeR != null &&
          e.r != null &&
          e.r > 0 &&
          e.excursion.maeR > e.r,
      )
      .map((e) =>
        insight(e, {
          ruleId: "drawdown_exceeds_profit",
          severity: "warning",
          title: "Drawdown larger than the profit",
          detail: `It went ${r2(e.excursion.maeR!)}R against you to return ${r2(
            e.r!,
          )}R. The risk you actually carried is larger than the R-multiple suggests.`,
        }),
      ),
};

/**
 * The entry that did not hurt.
 *
 * ONE RULE, TWO DEGREES. `no_drawdown` (the price never came back below the
 * entry at all) was a separate rule saying this one's sentence in its extreme
 * form — and since it required `maeR === 0` while this required `maeR > 0`,
 * the two could never both fire on the same trade. Two ids, two panel rows and
 * two entries in the rule catalogue for one observation.
 */
export const cleanHold: Rule = {
  id: "clean_hold",
  level: "trade",
  minSample: 0,
  description:
    "The entry never hurt: no drawdown at all, or profit several times over it.",
  evaluate: (ctx) =>
    ctx.trades.flatMap((e) => {
      // No `e.r` guard: `no_drawdown` never had one, and adding it here would
      // have silently dropped a winner whose R could not be computed.
      if (e.outcome !== "win" || e.excursion.maeR == null) return [];

      if (e.excursion.maeR === 0) {
        return insight(e, {
          ruleId: "clean_hold",
          severity: "good",
          title: "No drawdown",
          detail: "Price never came back below the entry — a clean entry.",
        });
      }
      if (
        e.r != null &&
        e.r > 0 &&
        e.excursion.maeR > 0 &&
        e.r >= e.excursion.maeR * T.CLEAN_HOLD_MULTIPLE
      ) {
        return insight(e, {
          ruleId: "clean_hold",
          severity: "good",
          title: "Clean hold",
          detail: `${r2(e.r)}R of profit with only ${r2(
            e.excursion.maeR,
          )}R against it — the thesis worked almost at once.`,
        });
      }
      return [];
    }),
};

export const redToGreen: Rule = {
  id: "red_to_green",
  level: "trade",
  minSample: 0,
  description: "Was in drawdown, closed in profit.",
  evaluate: (ctx) =>
    ctx.trades
      .filter(
        (e) =>
          e.outcome === "win" &&
          e.excursion.maeR != null &&
          e.excursion.maeR >= T.WAS_RED_R,
      )
      .map((e) =>
        insight(e, {
          ruleId: "red_to_green",
          severity: "info",
          title: "Red to green",
          detail: `It went ${r2(
            e.excursion.maeR!,
          )}R against you before it worked — you held, but check whether the stop was in the right place.`,
        }),
      ),
};

/**
 * Held longer than your own history says you hold.
 *
 * TWO RULES, ONE CAUSE, TWO SEVERITIES. `loser_long_hold` was a separate rule
 * for the case that costs money: a loser held past the median loser AND bigger
 * than the average loss. It is this observation with the outcome attached, so
 * it is the critical branch now rather than a second row in the panel.
 */
export const exceedAvgHoldTime: Rule = {
  id: "exceed_avg_hold_time",
  level: "trade",
  // Comparing against "your own winners" is meaningless until there are enough
  // winners to form a distribution.
  minSample: BASELINE_MIN,
  description: "Held longer than your own history - worst when it was a loser.",
  evaluate: (ctx) => {
    const p75 = ctx.baseline.winnerHoldP75;
    const med = ctx.baseline.loserHoldMedian;
    const avgLoss = ctx.baseline.avgLossMagnitude;

    return ctx.trades.flatMap((e) => {
      if (e.durationSeconds == null) return [];

      // Hope, not a plan: a loser held past the median AND costlier than usual.
      if (
        e.outcome === "loss" &&
        med != null &&
        avgLoss != null &&
        e.durationSeconds > med &&
        Math.abs(e.pnl) > avgLoss
      ) {
        return insight(e, {
          ruleId: "exceed_avg_hold_time",
          severity: "critical",
          title: "Loser held too long",
          detail: `${formatDuration(e.durationSeconds)} and ${fmtMoney(
            e.pnl,
            ctx.currency,
          )} — longer and costlier than your typical loss. Hope, not a plan.`,
          sample: ctx.baseline.sample,
        });
      }

      if (p75 != null && e.durationSeconds > p75) {
        return insight(e, {
          ruleId: "exceed_avg_hold_time",
          severity: "info",
          title: "Longer than usual",
          detail: `Held ${formatDuration(
            e.durationSeconds,
          )} — longer than 75 % of your winners (${formatDuration(p75)}).`,
          sample: ctx.baseline.sample,
        });
      }

      return [];
    });
  },
};

export const gaveBackProfit: Rule = {
  id: "gave_back_profit",
  level: "trade",
  minSample: 0,
  description: "A move that was in your favour and was not kept.",
  evaluate: (ctx) => {
    const avgMfe = ctx.baseline.avgMfeR;
    const haveBaseline = avgMfe != null && ctx.baseline.sample >= BASELINE_MIN;

    return ctx.trades.flatMap((e) => {
      const mfe = e.excursion.mfeR;
      const capture = e.excursion.capturePct;
      if (mfe == null) return [];

      // Handed all the way back to a loss.
      if (e.outcome === "loss" && mfe >= T.WAS_GREEN_R) {
        return insight(e, {
          ruleId: "gave_back_profit",
          severity: "critical",
          title: "Green to red",
          detail: `It was ${r2(mfe)}R in profit and closed at ${fmtMoney(
            e.pnl,
            ctx.currency,
          )}.`,
        });
      }

      // Handed back to a scratch.
      if (e.outcome === "breakeven" && mfe >= 1) {
        return insight(e, {
          ruleId: "gave_back_profit",
          severity: "warning",
          title: "Green to flat",
          detail: `The peak was ${r2(
            mfe,
          )}R and the result was zero. The whole move was given back.`,
        });
      }

      // A peak above your own average, mostly handed back. The one branch that
      // needs a history to compare against — and the one that is NOT restricted
      // to winners: the rule it came from had no outcome filter, so a loss
      // whose peak beat your average but never reached the half-R the first
      // branch asks for is still a move you had and did not keep.
      if (
        haveBaseline &&
        capture != null &&
        mfe > avgMfe &&
        capture < T.GAVE_BACK_CAPTURE_PCT
      ) {
        return insight(e, {
          ruleId: "gave_back_profit",
          severity: "warning",
          title: "Above-average move given back",
          detail: `A peak of ${r2(mfe)}R (above your average of ${r2(
            avgMfe,
          )}R), and you took ${capture.toFixed(0)} % of it.`,
          sample: ctx.baseline.sample,
        });
      }

      // Any winner that kept little of its move.
      if (e.outcome === "win" && capture != null && capture < T.GAVE_BACK_CAPTURE_PCT) {
        return insight(e, {
          ruleId: "gave_back_profit",
          severity: "warning",
          title: "Little of the move taken",
          detail: `You kept ${capture.toFixed(
            0,
          )} % of the maximum move in your favour.`,
        });
      }

      // `weak_win` WAS A FIFTH RULE AND IS NOT A FIFTH BRANCH, because it
      // could never have fired on its own: it asked for `r < 0.3` with an MFE
      // of at least 1R, which is a capture below 30 % by arithmetic — always
      // inside the 40 % branch above. Every weak win was already reported
      // twice, under two headings, as two problems. Merging the rules is what
      // made that visible; keeping the branch would have kept it invisible.

      return [];
    });
  },
};

export const revengeTrade: Rule = {
  id: "revenge_trade",
  level: "trade",
  minSample: 0,
  description:
    "An entry within minutes of a loss on the same account, which itself ended in a loss.",
  evaluate: (ctx) => {
    // Sorted newest-first so the loss reported is the one actually being
    // reacted to, rather than whichever qualifying loss happens to be oldest.
    const lossesNewestFirst = [...ctx.trades]
      .filter((e) => e.outcome === "loss" && e.closedAt)
      .sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? ""));

    const out: Insight[] = [];
    for (const e of ctx.trades) {
      if (e.outcome !== "loss" || !e.openedAt) continue;
      const opened = new Date(e.openedAt).getTime();
      const priorLoss = lossesNewestFirst.find((p) => {
        if (p.id === e.id || !p.closedAt || p.accountId !== e.accountId) return false;
        const gapMinutes = (opened - new Date(p.closedAt).getTime()) / 60_000;
        return gapMinutes >= 0 && gapMinutes <= T.REVENGE_WINDOW_MINUTES;
      });
      if (!priorLoss) continue;
      out.push(
        insight(e, {
          ruleId: "revenge_trade",
          severity: "critical",
          title: "Revenge entry",
          detail: `Opened within ${T.REVENGE_WINDOW_MINUTES} min of a loss on ${priorLoss.label} and also ended in a loss.`,
        }),
      );
    }
    return out;
  },
};

/**
 * Every entry of an account's day from the first one taken after `TILT_LOSSES`
 * losses in a row — the point where the day should have ended. What follows it
 * is the tilt, whatever it made: the rule measures the cost, it forbids nothing.
 */
function tiltEntries(trades: EnrichedTrade[]): Set<string> {
  const byDay = new Map<string, EnrichedTrade[]>();
  for (const e of trades) {
    if (e.lossStreakBefore == null) continue;
    const key = `${e.accountId}|${e.openDay}`;
    byDay.set(key, [...(byDay.get(key) ?? []), e]);
  }
  const out = new Set<string>();
  for (const day of byDay.values()) {
    day.sort((a, b) => (a.openedAt ?? "").localeCompare(b.openedAt ?? ""));
    const from = day.findIndex((e) => e.lossStreakBefore! >= T.TILT_LOSSES);
    if (from >= 0) for (const e of day.slice(from)) out.add(e.id);
  }
  return out;
}

export const tiltAfterLosses: Rule = {
  id: "tilt_after_losses",
  level: "trade",
  minSample: 0,
  description:
    "An entry after two losses in a row on the same account and day — with what it cost.",
  evaluate: (ctx) => {
    const tilt = tiltEntries(ctx.trades);
    if (tilt.size === 0) return [];

    // "Otherwise": the R of every trade that was not taken in tilt.
    const elsewhere = ctx.trades
      .filter((e) => !tilt.has(e.id) && e.r != null)
      .map((e) => e.r!);
    const avgElsewhere =
      elsewhere.length > 0 ? elsewhere.reduce((a, b) => a + b, 0) / elsewhere.length : null;

    return ctx.trades
      .filter((e) => tilt.has(e.id))
      .map((e) => {
        const opened = new Date(e.openedAt!).getTime();
        // The trade just before it on the same account and day: the last close
        // the trader re-entered from, and the size they had been trading.
        const before = ctx.trades
          .filter(
            (p) =>
              p.id !== e.id &&
              p.accountId === e.accountId &&
              p.openDay === e.openDay &&
              p.closedAt != null &&
              new Date(p.closedAt).getTime() <= opened,
          )
          .sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? ""))[0];
        const parts = [
          `After ${T.TILT_LOSSES}+ losses in a row on this account that day`,
          before
            ? `re-entered ${formatDuration((opened - new Date(before.closedAt!).getTime()) / 1000)} after the last close`
            : null,
          e.size != null
            ? `${e.size} contracts${before?.size != null ? ` (${before.size} before)` : ""}`
            : null,
          `${e.r != null ? `${r2(e.r)}R, ` : ""}${fmtMoney(e.pnl, ctx.currency)}`,
        ].filter((p): p is string => p != null);
        return insight(e, {
          ruleId: "tilt_after_losses",
          severity: e.pnl < 0 ? "critical" : "warning",
          title: "Traded on after the loss limit",
          detail: `${parts.join(" — ")}.${
            avgElsewhere != null ? ` Your other trades average ${r2(avgElsewhere)}R.` : ""
          }`,
          sample: elsewhere.length,
        });
      });
  },
};

export const scaleIn: Rule = {
  id: "scale_in",
  level: "trade",
  minSample: 0,
  description: "Several entry fills.",
  evaluate: (ctx) =>
    ctx.trades
      .filter((e) => e.entryFills > 1)
      .map((e) =>
        insight(e, {
          ruleId: "scale_in",
          severity: "info",
          title: "Scale-in",
          detail: `${e.entryFills} entry fills, average entry ${
            e.trade.row.stats?.avg_entry?.toFixed(4) ?? "—"
          }.`,
        }),
      ),
};

export const scaleOut: Rule = {
  id: "scale_out",
  level: "trade",
  minSample: 0,
  description: "Several exit fills.",
  evaluate: (ctx) =>
    ctx.trades
      .filter((e) => e.exitFills > 1)
      .map((e) =>
        insight(e, {
          ruleId: "scale_out",
          severity: "info",
          title: "Scale-out",
          detail: `${e.exitFills} exit fills, average exit ${
            e.trade.row.stats?.avg_exit?.toFixed(4) ?? "—"
          }.`,
        }),
      ),
};

export const unusualSize: Rule = {
  id: "unusual_size",
  level: "trade",
  minSample: 8,
  description: "Size larger than 75 % of your trades.",
  evaluate: (ctx) => {
    const p75 = ctx.baseline.sizeP75;
    if (p75 == null || !(p75 > 0)) return [];
    return ctx.trades
      .filter((e) => e.size != null && e.size > p75)
      .map((e) =>
        insight(e, {
          ruleId: "unusual_size",
          severity: e.outcome === "loss" ? "warning" : "info",
          title: "Above-average size",
          detail: `Size ${e.size} is above the 75th percentile (${p75.toFixed(
            2,
          )}) of your positions.`,
          sample: ctx.baseline.sample,
        }),
      );
  },
};

export const mostTimeInDrawdown: Rule = {
  id: "most_time_in_drawdown",
  level: "trade",
  minSample: 0,
  description:
    "The running P&L sat below zero for most of the trade (measured from the R2 candles).",
  evaluate: (ctx) =>
    ctx.trades
      .filter((e) => e.underwaterPct != null && e.underwaterPct >= T.MOSTLY_UNDERWATER_PCT)
      .map((e) => {
        const held = e.durationSeconds != null ? ` (${formatDuration(e.durationSeconds)})` : "";
        return insight(e, {
          ruleId: "most_time_in_drawdown",
          severity: e.outcome === "loss" ? "warning" : "info",
          title: e.outcome === "loss" ? "Underwater most of the trade" : "Paid, after sitting underwater",
          detail:
            e.outcome === "loss"
              ? `In the red for ${e.underwaterPct}% of the trade${held}, closed ${fmtMoney(e.pnl, ctx.currency)}.`
              : `In the red for ${e.underwaterPct}% of the trade${held} before it closed ${fmtMoney(
                  e.pnl,
                  ctx.currency,
                )} — the entry came early.`,
        });
      }),
};

export const TRADE_RULES: Rule[] = [
  drawdownExceedsProfit,
  cleanHold,
  redToGreen,
  exceedAvgHoldTime,
  gaveBackProfit,
  revengeTrade,
  tiltAfterLosses,
  mostTimeInDrawdown,
  scaleIn,
  scaleOut,
  unusualSize,
];
