/**
 * Trade-level insight rules.
 *
 * Thresholds live in one block at the top: they are business judgement, not
 * arithmetic, and every one of them should be arguable without touching logic.
 *
 * Swing translation matters here. TradeZella's revenge-trade rule looks for a
 * re-entry within thirty seconds of a loss; at swing cadence the equivalent
 * window is the same or next day. Its hold-time rule compares against hours;
 * ours compares against the 75th percentile of your own winners, in days.
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
  /** A win this small in R, after a big MFE, is a weak win rather than an edge. */
  WEAK_WIN_R: 0.3,
  WEAK_WIN_MFE_R: 1,
  /** Profit exceeding drawdown by this multiple is a cleanly-held trade. */
  CLEAN_HOLD_MULTIPLE: 2,
  /** Days after a loss within which a re-entry counts as reactive. */
  REVENGE_WINDOW_DAYS: 1,
} as const;

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

export const noDrawdown: Rule = {
  id: "no_drawdown",
  level: "trade",
  minSample: 0,
  // Restricted to winners on purpose: a trade that never moved against you yet
  // still closed red is a fee-only loss, and calling that "good" would be wrong.
  description: "A winner that was never underwater.",
  evaluate: (ctx) =>
    ctx.trades
      .filter((e) => e.excursion.maeR === 0 && e.outcome === "win")
      .map((e) =>
        insight(e, {
          ruleId: "no_drawdown",
          severity: "good",
          title: "No drawdown",
          detail: "Price never came back below the entry — a clean entry.",
        }),
      ),
};

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

export const cleanHold: Rule = {
  id: "clean_hold",
  level: "trade",
  minSample: 0,
  description: "The profit beat the drawdown several times over.",
  evaluate: (ctx) =>
    ctx.trades
      .filter(
        (e) =>
          e.r != null &&
          e.r > 0 &&
          e.excursion.maeR != null &&
          e.excursion.maeR > 0 &&
          e.r >= e.excursion.maeR * T.CLEAN_HOLD_MULTIPLE,
      )
      .map((e) =>
        insight(e, {
          ruleId: "clean_hold",
          severity: "good",
          title: "Clean hold",
          detail: `${r2(e.r!)}R of profit with only ${r2(
            e.excursion.maeR!,
          )}R protiv — teza je radila skoro odmah.`,
        }),
      ),
};

export const greenToRed: Rule = {
  id: "green_to_red",
  level: "trade",
  minSample: 0,
  description: "Was in profit, closed at a loss.",
  evaluate: (ctx) =>
    ctx.trades
      .filter(
        (e) =>
          e.outcome === "loss" &&
          e.excursion.mfeR != null &&
          e.excursion.mfeR >= T.WAS_GREEN_R,
      )
      .map((e) =>
        insight(e, {
          ruleId: "green_to_red",
          severity: "critical",
          title: "Green to red",
          detail: `It was ${r2(
            e.excursion.mfeR!,
          )}R u profitu pa zatvoren sa ${fmtMoney(e.pnl, ctx.currency)}.`,
        }),
      ),
};

export const greenToBreakeven: Rule = {
  id: "green_to_breakeven",
  level: "trade",
  minSample: 0,
  description: "Was in profit, finished around zero.",
  evaluate: (ctx) =>
    ctx.trades
      .filter(
        (e) =>
          e.outcome === "breakeven" &&
          e.excursion.mfeR != null &&
          e.excursion.mfeR >= 1,
      )
      .map((e) =>
        insight(e, {
          ruleId: "green_to_breakeven",
          severity: "warning",
          title: "Green to flat",
          detail: `The peak was ${r2(
            e.excursion.mfeR!,
          )}R, and the result was zero. The whole move was given back.`,
        }),
      ),
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

export const exceedAvgHoldTime: Rule = {
  id: "exceed_avg_hold_time",
  level: "trade",
  // Comparing against "your own winners" is meaningless until there are enough
  // winners to form a distribution.
  minSample: 8,
  description: "Held longer than 75 % of your winners.",
  evaluate: (ctx) => {
    const p75 = ctx.baseline.winnerHoldP75;
    if (p75 == null) return [];
    return ctx.trades
      .filter((e) => e.durationSeconds != null && e.durationSeconds > p75)
      .map((e) =>
        insight(e, {
          ruleId: "exceed_avg_hold_time",
          severity: "info",
          title: "Longer than usual",
          detail: `Held ${formatDuration(
            e.durationSeconds,
          )} — longer than 75 % of your winners (${formatDuration(p75)}).`,
          sample: ctx.baseline.sample,
        }),
      );
  },
};

export const loserLongHold: Rule = {
  id: "loser_long_hold",
  level: "trade",
  minSample: 8,
  description:
    "A loser held longer than the median loser and larger than the average loss.",
  evaluate: (ctx) => {
    const med = ctx.baseline.loserHoldMedian;
    const avgLoss = ctx.baseline.avgLossMagnitude;
    if (med == null || avgLoss == null) return [];
    return ctx.trades
      .filter(
        (e) =>
          e.outcome === "loss" &&
          e.durationSeconds != null &&
          e.durationSeconds > med &&
          Math.abs(e.pnl) > avgLoss,
      )
      .map((e) =>
        insight(e, {
          ruleId: "loser_long_hold",
          severity: "critical",
          title: "Loser held too long",
          detail: `${formatDuration(
            e.durationSeconds,
          )} i ${fmtMoney(e.pnl, ctx.currency)} — longer and costlier than your typical loss. Hope, not a plan.`,
          sample: ctx.baseline.sample,
        }),
      );
  },
};

export const gaveBackProfit: Rule = {
  id: "gave_back_profit",
  level: "trade",
  minSample: 8,
  description: "A profit peak above your average, closed well below it.",
  evaluate: (ctx) => {
    const avgMfe = ctx.baseline.avgMfeR;
    if (avgMfe == null) return [];
    return ctx.trades
      .filter(
        (e) =>
          e.excursion.mfeR != null &&
          e.excursion.mfeR > avgMfe &&
          e.excursion.capturePct != null &&
          e.excursion.capturePct < T.GAVE_BACK_CAPTURE_PCT,
      )
      .map((e) =>
        insight(e, {
          ruleId: "gave_back_profit",
          severity: "warning",
          title: "Above-average move given back",
          detail: `A peak of ${r2(
            e.excursion.mfeR!,
          )}R (above your average of ${r2(avgMfe)}R), and you took ${e.excursion.capturePct!.toFixed(
            0,
          )} % toga.`,
          sample: ctx.baseline.sample,
        }),
      );
  },
};

export const maximizeYourProfit: Rule = {
  id: "maximize_your_profit",
  level: "trade",
  minSample: 0,
  description: "A winner where most of the move was given back.",
  evaluate: (ctx) =>
    ctx.trades
      .filter(
        (e) =>
          e.outcome === "win" &&
          e.excursion.capturePct != null &&
          e.excursion.capturePct < T.GAVE_BACK_CAPTURE_PCT,
      )
      .map((e) =>
        insight(e, {
          ruleId: "maximize_your_profit",
          severity: "warning",
          title: "Little of the move taken",
          detail: `You kept ${e.excursion.capturePct!.toFixed(
            0,
          )} % of the maximum move in your favour.`,
        }),
      ),
};

export const weakWin: Rule = {
  id: "weak_win",
  level: "trade",
  minSample: 0,
  description: "Closed green, but barely — with a large missed move.",
  evaluate: (ctx) =>
    ctx.trades
      .filter(
        (e) =>
          e.outcome === "win" &&
          e.r != null &&
          e.r < T.WEAK_WIN_R &&
          e.excursion.mfeR != null &&
          e.excursion.mfeR >= T.WEAK_WIN_MFE_R,
      )
      .map((e) =>
        insight(e, {
          ruleId: "weak_win",
          severity: "info",
          title: "Weak winner",
          detail: `${r2(e.r!)}R taken from a move of ${r2(
            e.excursion.mfeR!,
          )}R — green on paper, missed in practice.`,
        }),
      ),
};

export const revengeTrade: Rule = {
  id: "revenge_trade",
  level: "trade",
  minSample: 0,
  description:
    "An entry the same or next day after a loss, which itself ended in a loss.",
  evaluate: (ctx) => {
    // Swing translation of TradeZella's 30-second window. Sorted newest-first
    // so the loss reported is the one actually being reacted to, rather than
    // whichever qualifying loss happens to be oldest.
    const lossesNewestFirst = [...ctx.trades]
      .filter((e) => e.outcome === "loss" && e.closedAt)
      .sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? ""));

    const out: Insight[] = [];
    for (const e of ctx.trades) {
      if (e.outcome !== "loss" || !e.openedAt) continue;
      const opened = new Date(e.openedAt).getTime();
      const priorLoss = lossesNewestFirst.find((p) => {
        if (p.id === e.id || !p.closedAt) return false;
        const closed = new Date(p.closedAt).getTime();
        const gapDays = (opened - closed) / 86_400_000;
        return gapDays >= 0 && gapDays <= T.REVENGE_WINDOW_DAYS;
      });
      if (!priorLoss) continue;
      out.push(
        insight(e, {
          ruleId: "revenge_trade",
          severity: "critical",
          title: "Revenge entry",
          detail: `Opened within ${T.REVENGE_WINDOW_DAYS} days of a loss on ${priorLoss.label} and also ended in a loss.`,
        }),
      );
    }
    return out;
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
          )}) tvojih pozicija.`,
          sample: ctx.baseline.sample,
        }),
      );
  },
};

export const TRADE_RULES: Rule[] = [
  noDrawdown,
  drawdownExceedsProfit,
  cleanHold,
  greenToRed,
  greenToBreakeven,
  redToGreen,
  exceedAvgHoldTime,
  loserLongHold,
  gaveBackProfit,
  maximizeYourProfit,
  weakWin,
  revengeTrade,
  scaleIn,
  scaleOut,
  unusualSize,
];
