/**
 * Day-level insight rules.
 *
 * A "day" here is a close date — the day bucket answers what the day produced,
 * and production is realization.
 */

import { fmtMoney } from "../format";
import { isShortDirection } from "../plan-calculations";
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

export const DAY_RULES: Rule[] = [
  perfectDay,
  highConvictionDay,
  sizingProblemDay,
  flipFlopDay,
  leftMoneyOnTable,
  overconfidence,
];
