/**
 * Day-level insight rules.
 *
 * A "day" here is a close date on the account's own day — a Topstep account's
 * runs 17:00→17:00 CT — because the day bucket answers what the day produced,
 * and production is realization. Overtrading and efficiency were measured per
 * WEEK while the book was swing; for a day trader the day is the unit (F5.3).
 */

import { fmtMoney } from "../format";
import { isShortDirection } from "../plan-calculations";
import { minutesAfterOpen } from "../session-window";
import type { DayBucket, InsightContext } from "./context";
import type { Insight, InsightRule } from "./types";
import { winRateOf } from "../analytics";

const D = {
  /** R at which a single-trade day counts as a conviction day. */
  HIGH_CONVICTION_R: 2,
  /** Win rate above which a red day is a sizing problem, not a picking one. */
  SIZING_PROBLEM_WIN_PCT: 50,
  /** Unrealized R left behind before a day is flagged. */
  MONEY_ON_TABLE_R: 2,
  /** Size increase multiple after a winning run that counts as escalation. */
  OVERCONFIDENCE_MULTIPLE: 1.5,
  /** Consecutive wins before an escalation counts as a streak. */
  OVERCONFIDENCE_STREAK: 2,
  /** Trades above this multiple of your daily average is overtrading. */
  OVERTRADING_MULTIPLE: 2,
  /** Trading days needed before "your average day" means anything. */
  BASELINE_DAYS: 10,
  /** Net below this share of your average green day is low efficiency. */
  LOW_EFFICIENCY_SHARE: 0.25,
  /** Trades needed in a day before efficiency is worth judging. */
  LOW_EFFICIENCY_MIN_TRADES: 4,
  /**
   * Minutes after the 09:30 ET open before the first entry counts as patient —
   * the whole Open window (09:30–10:00, L1) left alone.
   */
  PATIENCE_MINUTES: 30,
  /** Share of the day's time in trades spent underwater (%) that makes it a deep day. */
  DEEP_UNDERWATER_PCT: 75,
} as const;

type Rule = InsightRule<InsightContext>;

const dayInsight = (
  d: DayBucket,
  partial: Omit<Insight, "subjectId" | "subjectLabel" | "level">,
): Insight => ({
  ...partial,
  level: "day",
  subjectId: d.key,
  subjectLabel: d.key,
});

export const perfectDay: Rule = {
  id: "perfect_day",
  level: "day",
  minSample: 0,
  description: "A green day, every trade a winner, none went against you.",
  evaluate: (ctx) =>
    ctx.days
      .filter(
        (d) =>
          d.trades.length > 0 &&
          d.net > 0 &&
          d.losses === 0 &&
          d.trades.every(
            (e) => e.excursion.maeR != null && e.excursion.maeR === 0,
          ),
      )
      .map((d) =>
        dayInsight(d, {
          ruleId: "perfect_day",
          severity: "good",
          title: "Perfect day",
          detail: `${d.trades.length} trades, ${fmtMoney(
            d.net,
            ctx.currency,
          )}, and not one of them went red.`,
        }),
      ),
};

export const highConvictionDay: Rule = {
  id: "high_conviction_day",
  level: "day",
  minSample: 0,
  description: "A single trade, high R.",
  evaluate: (ctx) =>
    ctx.days
      .filter(
        (d) =>
          d.trades.length === 1 &&
          d.trades[0].r != null &&
          d.trades[0].r >= D.HIGH_CONVICTION_R,
      )
      .map((d) =>
        dayInsight(d, {
          ruleId: "high_conviction_day",
          severity: "good",
          title: "High-conviction day",
          detail: `One trade (${d.trades[0].label}) for ${d.trades[0].r!.toFixed(
            2,
          )}R. No noise.`,
        }),
      ),
};

export const sizingProblemDay: Rule = {
  id: "sizing_problem_day",
  level: "day",
  minSample: 0,
  description:
    "A high win rate but a red day — the average loss beats the average win.",
  evaluate: (ctx) =>
    ctx.days
      .filter((d) => {
        const decided = d.wins + d.losses;
        if (decided < 2 || d.net >= 0) return false;
        return (winRateOf(d.wins, d.losses) ?? 0) >= D.SIZING_PROBLEM_WIN_PCT;
      })
      .map((d) =>
        dayInsight(d, {
          ruleId: "sizing_problem_day",
          severity: "critical",
          title: "More winners, red day",
          detail: `${d.wins}W / ${d.losses}L and the result ${fmtMoney(
            d.net,
            ctx.currency,
          )}. The problem is loss size, not trade selection.`,
        }),
      ),
};

function directions(d: DayBucket): { longs: number; shorts: number } {
  let longs = 0;
  let shorts = 0;
  for (const e of d.trades) {
    if (isShortDirection((e.trade.row.direction as string) ?? null)) shorts++;
    else longs++;
  }
  return { longs, shorts };
}

export const flipFlopDay: Rule = {
  id: "flip_flop_day",
  level: "day",
  minSample: 0,
  description: "Both sides on the same day.",
  evaluate: (ctx) =>
    ctx.days
      .filter((d) => {
        const { longs, shorts } = directions(d);
        return longs > 0 && shorts > 0;
      })
      .map((d) => {
        const { longs, shorts } = directions(d);
        const red = d.net < 0;
        return dayInsight(d, {
          ruleId: "flip_flop_day",
          severity: red ? "warning" : "info",
          title: red ? "Side-switching, red day" : "Side-switching, green day",
          detail: red
            ? `${longs} long and ${shorts} short on the same day for ${fmtMoney(
                d.net,
                ctx.currency,
              )} — the bias was not settled.`
            : `${longs} long and ${shorts} short on the same day for ${fmtMoney(
                d.net,
                ctx.currency,
              )}. It worked, but check whether it could have been cleaner.`,
        });
      }),
};

export const leftMoneyOnTable: Rule = {
  id: "left_money_on_table",
  level: "day",
  minSample: 0,
  description: "The sum of missed move across that day's trades.",
  evaluate: (ctx) =>
    ctx.days
      .map((d) => {
        let missed = 0;
        let counted = 0;
        for (const e of d.trades) {
          if (e.excursion.mfeR == null || e.r == null) continue;
          const gap = e.excursion.mfeR - e.r;
          if (gap > 0) {
            missed += gap;
            counted++;
          }
        }
        return { d, missed, counted };
      })
      .filter((x) => x.counted > 0 && x.missed >= D.MONEY_ON_TABLE_R)
      .map(({ d, missed, counted }) =>
        dayInsight(d, {
          ruleId: "left_money_on_table",
          severity: "warning",
          title: "Left on the table",
          detail: `${missed.toFixed(
            2,
          )}R left on the table across ${counted} trades that day.`,
        }),
      ),
};

export const overconfidence: Rule = {
  id: "overconfidence",
  level: "day",
  minSample: 0,
  description: "Size raised after a winning streak, then a loss.",
  evaluate: (ctx) => {
    const ordered = [...ctx.trades]
      .filter((e) => e.closedAt && e.size != null && e.size > 0)
      .sort((a, b) => (a.closedAt ?? "").localeCompare(b.closedAt ?? ""));

    const out: Insight[] = [];
    let streak = 0;
    for (let i = 0; i < ordered.length; i++) {
      const e = ordered[i];
      const prev = ordered[i - 1];
      if (
        streak >= D.OVERCONFIDENCE_STREAK &&
        e.outcome === "loss" &&
        prev?.size != null &&
        e.size! >= prev.size * D.OVERCONFIDENCE_MULTIPLE
      ) {
        out.push({
          ruleId: "overconfidence",
          level: "day",
          severity: "critical",
          title: "Overconfidence",
          detail: `After ${streak} wins in a row the size was raised from ${prev.size} to ${e.size} — and the trade lost ${fmtMoney(
            e.pnl,
            ctx.currency,
          )}.`,
          subjectId: e.id,
          subjectLabel: e.label,
        });
      }
      if (e.outcome === "win") streak++;
      else if (e.outcome === "loss") streak = 0;
    }
    return out;
  },
};

export const overtradingDay: Rule = {
  id: "overtrading_day",
  level: "day",
  minSample: D.BASELINE_DAYS,
  description: "Trade count far above your daily average.",
  evaluate: (ctx) => {
    const avg = ctx.baseline.dailyTradeCountAvg;
    if (avg == null || ctx.days.length < D.BASELINE_DAYS) return [];
    return ctx.days
      .filter((d) => d.trades.length > avg * D.OVERTRADING_MULTIPLE)
      .map((d) =>
        dayInsight(d, {
          ruleId: "overtrading_day",
          severity: d.net < 0 ? "critical" : "warning",
          title: "Overtrading day",
          detail: `${d.trades.length} trades against an average of ${avg.toFixed(
            1,
          )} a day — result ${fmtMoney(d.net, ctx.currency)}.`,
          sample: ctx.days.length,
        }),
      );
  },
};

export const lowEfficiencyDay: Rule = {
  id: "low_efficiency_day",
  level: "day",
  minSample: D.BASELINE_DAYS,
  description: "Many trades, a small result compared with your average green day.",
  evaluate: (ctx) => {
    const greenAvg = ctx.baseline.greenDayAvgNet;
    if (greenAvg == null || !(greenAvg > 0) || ctx.days.length < D.BASELINE_DAYS) return [];
    return ctx.days
      .filter(
        (d) =>
          d.trades.length >= D.LOW_EFFICIENCY_MIN_TRADES &&
          d.net > 0 &&
          d.net < greenAvg * D.LOW_EFFICIENCY_SHARE,
      )
      .map((d) =>
        dayInsight(d, {
          ruleId: "low_efficiency_day",
          severity: "warning",
          title: "Poor efficiency",
          detail: `${d.trades.length} trades for ${fmtMoney(
            d.net,
            ctx.currency,
          )} — your average green day carries ${fmtMoney(
            greenAvg,
            ctx.currency,
          )}. Mnogo rada za malo.`,
          sample: ctx.days.length,
        }),
      );
  },
};

/** The day's first entry, or null when no entry time is known. */
function firstEntry(d: DayBucket): string | null {
  const opened = d.trades
    .map((e) => e.openedAt)
    .filter((o): o is string => o != null)
    .sort();
  return opened[0] ?? null;
}

export const patiencePaidOff: Rule = {
  id: "patience_paid_off",
  level: "day",
  minSample: 0,
  description:
    "A green day whose first entry came after the opening half hour (09:30–10:00 ET).",
  evaluate: (ctx) =>
    ctx.days
      .map((d) => ({ d, after: minutesAfterOpen(firstEntry(d)) }))
      .filter(
        (x): x is { d: DayBucket; after: number } =>
          x.after != null && x.after >= D.PATIENCE_MINUTES && x.d.net > 0,
      )
      .map(({ d, after }) =>
        dayInsight(d, {
          ruleId: "patience_paid_off",
          severity: "good",
          title: "Patience paid off",
          detail: `First entry ${after} min after the 09:30 ET open, and the day closed ${fmtMoney(
            d.net,
            ctx.currency,
          )}. The opening swings were left alone.`,
        }),
      ),
};

/**
 * The day's time in trades spent underwater, weighted by each trade's length —
 * or null unless EVERY trade of the day was measured: a share of part of the
 * day would be a share of something else.
 */
function dayUnderwaterPct(d: DayBucket): number | null {
  let under = 0;
  let total = 0;
  for (const e of d.trades) {
    if (e.underwaterPct == null || e.durationSeconds == null) return null;
    under += (e.underwaterPct / 100) * e.durationSeconds;
    total += e.durationSeconds;
  }
  return total > 0 ? (100 * under) / total : null;
}

export const deepInDrawdownDay: Rule = {
  id: "deep_in_drawdown_day",
  level: "day",
  minSample: 0,
  description:
    "Most of the day's time in trades was spent underwater (every trade measured from the R2 candles).",
  evaluate: (ctx) =>
    ctx.days
      .map((d) => ({ d, pct: dayUnderwaterPct(d) }))
      .filter((x): x is { d: DayBucket; pct: number } => x.pct != null && x.pct >= D.DEEP_UNDERWATER_PCT)
      .map(({ d, pct }) =>
        dayInsight(d, {
          ruleId: "deep_in_drawdown_day",
          severity: d.net < 0 ? "critical" : "warning",
          title: "Underwater most of the day",
          detail: `${d.trades.length} trades, ${Math.round(pct)}% of the time in them in the red — the day closed ${fmtMoney(
            d.net,
            ctx.currency,
          )}.`,
        }),
      ),
};

export const DAY_RULES: Rule[] = [
  perfectDay,
  highConvictionDay,
  sizingProblemDay,
  flipFlopDay,
  leftMoneyOnTable,
  overconfidence,
  overtradingDay,
  lowEfficiencyDay,
  patiencePaidOff,
  deepInDrawdownDay,
];
