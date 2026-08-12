/**
 * Week-level insight rules.
 *
 * These are the swing translations of TradeZella's day-level rules. Overtrading
 * measured per day is a day-trading question; for a book that holds positions
 * for a week, the unit that carries the same meaning is the week.
 */

import { fmtMoney } from "../format";
import { formatDuration } from "../units";
import type { InsightContext, WeekBucket } from "./context";
import type { Insight, InsightRule } from "./types";

const W = {
  /** Trades above this multiple of your weekly average is overtrading. */
  OVERTRADING_MULTIPLE: 2,
  /** Net below this share of your average green week is low efficiency. */
  LOW_EFFICIENCY_SHARE: 0.25,
  /** Trades needed in a week before efficiency is worth judging. */
  LOW_EFFICIENCY_MIN_TRADES: 4,
  /** Losses in a week that, with short holds, look like tilt. */
  TILT_MIN_LOSSES: 3,
  /** Hold time below which a swing trade was abandoned rather than managed. */
  TILT_MAX_HOLD_DAYS: 1,
} as const;

type Rule = InsightRule<InsightContext>;

const weekInsight = (
  w: WeekBucket,
  partial: Omit<Insight, "subjectId" | "subjectLabel" | "level">,
): Insight => ({
  ...partial,
  level: "week",
  subjectId: w.key,
  subjectLabel: `Week ${w.key}`,
});

export const overtradingWeek: Rule = {
  id: "overtrading_week",
  level: "week",
  // Needs several weeks before "your average week" means anything.
  minSample: 4,
  description: "Trade count far above your weekly average.",
  evaluate: (ctx) => {
    const avg = ctx.baseline.weeklyTradeCountAvg;
    if (avg == null || ctx.weeks.length < 4) return [];
    return ctx.weeks
      .filter((w) => w.trades.length > avg * W.OVERTRADING_MULTIPLE)
      .map((w) =>
        weekInsight(w, {
          ruleId: "overtrading_week",
          severity: w.net < 0 ? "critical" : "warning",
          title: "Overtrading week",
          detail: `${w.trades.length} trades against an average of ${avg.toFixed(
            1,
          )} — result ${fmtMoney(w.net, ctx.currency)}.`,
          sample: ctx.weeks.length,
        }),
      );
  },
};

export const lowEfficiencyWeek: Rule = {
  id: "low_efficiency_week",
  level: "week",
  minSample: 4,
  description: "Many trades, a small result compared with your average green week.",
  evaluate: (ctx) => {
    const greenAvg = ctx.baseline.greenWeekAvgNet;
    if (greenAvg == null || !(greenAvg > 0) || ctx.weeks.length < 4) return [];
    return ctx.weeks
      .filter(
        (w) =>
          w.trades.length >= W.LOW_EFFICIENCY_MIN_TRADES &&
          w.net > 0 &&
          w.net < greenAvg * W.LOW_EFFICIENCY_SHARE,
      )
      .map((w) =>
        weekInsight(w, {
          ruleId: "low_efficiency_week",
          severity: "warning",
          title: "Poor efficiency",
          detail: `${w.trades.length} trades for ${fmtMoney(
            w.net,
            ctx.currency,
          )} — your average green week carries ${fmtMoney(
            greenAvg,
            ctx.currency,
          )}. Mnogo rada za malo.`,
          sample: ctx.weeks.length,
        }),
      );
  },
};

export const tiltWeek: Rule = {
  id: "tilt_week",
  level: "week",
  minSample: 0,
  description:
    "A losing week with several losses and unusually short holds.",
  evaluate: (ctx) =>
    ctx.weeks
      .filter((w) => {
        if (w.net >= 0 || w.losses < W.TILT_MIN_LOSSES) return false;
        const held = w.trades
          .map((e) => e.durationDays)
          .filter((d): d is number => d != null);
        if (held.length === 0) return false;
        const avgDays = held.reduce((a, b) => a + b, 0) / held.length;
        return avgDays < W.TILT_MAX_HOLD_DAYS;
      })
      .map((w) => {
        const held = w.trades
          .map((e) => e.durationDays)
          .filter((d): d is number => d != null);
        const avgSeconds =
          (held.reduce((a, b) => a + b, 0) / held.length) * 86_400;
        return weekInsight(w, {
          ruleId: "tilt_week",
          severity: "critical",
          title: "Tilt week",
          detail: `${w.losses} losses, ${fmtMoney(
            w.net,
            ctx.currency,
          )}, average hold ${formatDuration(
            avgSeconds,
          )}. For a swing book that is reacting, not managing a position.`,
        });
      }),
};

export const WEEK_RULES: Rule[] = [
  overtradingWeek,
  lowEfficiencyWeek,
  tiltWeek,
];
