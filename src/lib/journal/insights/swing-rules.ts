/**
 * Insights about a MULTI-DAY hold.
 *
 * A separate family from `process-rules.ts` because they ask a question a day
 * trader's journal cannot: not "was the entry good", but "what did you do with
 * the position over the days you owned it". They all read either the per-position
 * check-ins or the thesis and time stop written at entry — the three fields
 * phases 1 and 2 added.
 *
 * The pattern common to all of them is the one that costs a swing trader money:
 * the reason to be in a trade expires before the trade does.
 */

import { parseScaleOutLevels } from "../scale-out";
import { stringFieldValue } from "../field-values";
import { fmtMoney } from "../format";
import { isInterference } from "../position-checkin";
import type { EnrichedTrade, InsightContext } from "./context";
import type { Insight, InsightRule } from "./types";

const P = {
  /** Trades needed before a category's average is worth printing. */
  MIN_CATEGORY_SAMPLE: 4,
  /**
   * Share of entries without a written thesis that counts as a habit.
   *
   * Not zero: one unwritten thesis is a busy morning. A third of them is how
   * you trade.
   */
  NO_THESIS_SHARE: 0.34,
  /** Entries needed before that share means anything. */
  MIN_THESIS_SAMPLE: 8,
} as const;

type Rule = InsightRule<InsightContext>;

const rPart = (e: EnrichedTrade, currency: string) =>
  e.r != null ? `${e.r.toFixed(2)}R` : fmtMoney(e.pnl, currency);

/**
 * The reason to hold expired, and the position did not.
 *
 * This is the rule the whole redesign was built to make possible, and nothing
 * before phase 2 could express it: `micromanage` was a fact about a DAY, so
 * "this position's thesis died on Tuesday and I was still in it on Friday" had
 * nowhere to live.
 *
 * Critical regardless of outcome, and that is the point. A trade held past its
 * invalidation that happened to win is the most expensive kind of win — it pays
 * for the habit that loses next time.
 */
export const thesisInvalidatedButHeld: Rule = {
  id: "thesis_invalidated_but_held",
  level: "trade",
  minSample: 0,
  description:
    "A position you recorded as invalidated and went on holding into a later day.",
  evaluate: (ctx) => {
    const out: Insight[] = [];
    for (const e of ctx.trades) {
      const rows = ctx.checkinsByPosition.get(e.id) ?? [];
      // Sorted oldest-first by `buildInsightContext`, so the first hit is the
      // day the thesis died — the day the decision to keep holding was made.
      const died = rows.find((c) => c.thesis_state === "invalidated");
      if (!died) continue;

      // Same-day is not the pattern: calling it invalidated and closing it that
      // day IS the discipline this rule is looking for.
      if (!e.closeDay || e.closeDay <= died.report_date) continue;

      out.push({
        ruleId: "thesis_invalidated_but_held",
        level: "trade",
        severity: "critical",
        title: "Held past invalidation",
        detail: `You marked the thesis invalidated on ${died.report_date} and closed on ${e.closeDay}. Outcome: ${rPart(e, ctx.currency)}.`,
        subjectId: e.id,
        subjectLabel: e.label,
      });
    }
    return out;
  },
};

/**
 * Held past the exit deadline written at entry.
 *
 * The quiet sibling of the rule above: no thesis was declared dead, the
 * position simply outlived the plan for it. Worth its own rule because it is
 * the one broken rule that takes no action to break — moving a stop is
 * something you DO, sitting on a fourth day is something you fail to do, and
 * nothing surfaces it unless something counts it.
 */
export const pastTimeStop: Rule = {
  id: "past_time_stop",
  level: "trade",
  minSample: 0,
  description: "A position held beyond the time stop set when it was opened.",
  evaluate: (ctx) =>
    ctx.trades
      .filter((e) => e.pastTimeStop)
      .map((e) => ({
        ruleId: "past_time_stop",
        level: "trade" as const,
        severity: "warning" as const,
        title: "Past the time stop",
        detail: `Held ${e.heldDays} days against a ${e.timeStopDays}-day stop. Outcome: ${rPart(e, ctx.currency)}.`,
        subjectId: e.id,
        subjectLabel: e.label,
      })),
};

/**
 * Entering without writing down why.
 *
 * Portfolio-level and about a habit, not a trade: one unwritten thesis is a
 * busy morning, a third of them is how you trade. It fires on the share rather
 * than on each instance for exactly that reason — a warning on every such trade
 * would be thirty warnings saying one thing.
 *
 * It matters more here than it would in a day-trading book. An intraday
 * position is closed before the reasoning could be forgotten; a four-day one is
 * re-judged every morning, and there is nothing to re-judge it against.
 */
export const entryWithoutThesis: Rule = {
  id: "entry_without_thesis",
  level: "portfolio",
  minSample: P.MIN_THESIS_SAMPLE,
  description:
    "The share of entries taken without a written thesis to judge them against later.",
  evaluate: (ctx) => {
    if (ctx.trades.length < P.MIN_THESIS_SAMPLE) return [];
    const missing = ctx.trades.filter(
      (e) => (stringFieldValue(e.trade.row, "thesis") ?? "").trim() === "",
    );
    const share = missing.length / ctx.trades.length;
    if (share < P.NO_THESIS_SHARE) return [];

    return [
      {
        ruleId: "entry_without_thesis",
        level: "portfolio",
        severity: "warning",
        title: "Entries with no written thesis",
        detail: `${missing.length} of ${ctx.trades.length} entries (${Math.round(share * 100)} %) carry no thesis. The daily check-in asks whether the reason for holding survived — with nothing written, that question has nothing to compare against.`,
        subjectId: "entry_without_thesis",
        sample: ctx.trades.length,
      },
    ];
  },
};

/**
 * How the weekend-hold subset actually performs.
 *
 * A weekend gap is a DIFFERENT risk from an overnight one, not a longer one:
 * the position sits through two days of news with no way out. This trader
 * crosses one rarely, which makes the subset small, self-selected and exactly
 * the sort of thing worth measuring rather than assuming about.
 *
 * Deliberately not a warning. It reports what the category did and lets the
 * number speak — including when it says the weekend holds are the good ones,
 * which is a finding too.
 */
export const weekendHoldRecord: Rule = {
  id: "weekend_hold_record",
  level: "portfolio",
  minSample: P.MIN_CATEGORY_SAMPLE,
  description: "What positions carried through a weekend did, against the rest.",
  evaluate: (ctx) => {
    const over = ctx.trades.filter((e) => e.weekendHold);
    const rest = ctx.trades.filter((e) => !e.weekendHold);
    if (over.length < P.MIN_CATEGORY_SAMPLE || rest.length === 0) return [];

    const avg = (xs: EnrichedTrade[]) =>
      xs.reduce((s, e) => s + e.pnl, 0) / xs.length;
    const overAvg = avg(over);
    const restAvg = avg(rest);
    const wins = over.filter((e) => e.outcome === "win").length;

    return [
      {
        ruleId: "weekend_hold_record",
        level: "portfolio",
        // Only worth flagging when the weekend subset is the worse one; when it
        // is not, the fact is still reported, just not as a problem.
        severity: overAvg < restAvg ? "warning" : "info",
        title: "Positions carried through a weekend",
        detail: `${over.length} positions crossed a weekend: ${wins} winners, averaging ${fmtMoney(overAvg, ctx.currency)} against ${fmtMoney(restAvg, ctx.currency)} on the ${rest.length} that did not.`,
        subjectId: "weekend_hold_record",
        sample: over.length,
      },
    ];
  },
};

/**
 * Touching a position on the same day its thesis was still intact.
 *
 * The complement of `micromanaged_a_setup`, which needs an A-grade setup to
 * fire. This one needs no grade — it needs the two answers to disagree, which is
 * the cleanest evidence there is that the intervention came from the screen and
 * not from the plan: nothing about the setup had changed that day, and you
 * changed the position anyway.
 */
export const touchedAnIntactThesis: Rule = {
  id: "touched_an_intact_thesis",
  level: "trade",
  minSample: 0,
  description:
    "A position you moved on a day you had just recorded its thesis as intact.",
  evaluate: (ctx) => {
    const out: Insight[] = [];
    for (const e of ctx.trades) {
      const day = (ctx.checkinsByPosition.get(e.id) ?? []).find(
        (c) => c.thesis_state === "intact" && isInterference(c.touched),
      );
      if (!day) continue;

      out.push({
        ruleId: "touched_an_intact_thesis",
        level: "trade",
        severity: "warning",
        title: "Managed a thesis that was fine",
        detail: `On ${day.report_date} you recorded the thesis as intact and moved the position anyway. Outcome: ${rPart(e, ctx.currency)}.`,
        subjectId: e.id,
        subjectLabel: e.label,
      });
    }
    return out;
  },
};

/**
 * Reducing a position that had no plan to be reduced.
 *
 * This is what makes `scale_out_plan` a column rather than a nicety. The daily
 * check-in records `partial_exit` on the day it happens, and on its own that
 * value cannot tell EXECUTING THE PLAN from BAILING EARLY — opposite facts about
 * a trader, stored identically. With a written scale-out to compare against, the
 * two separate.
 *
 * Same class of correction as phase 2's: a recorded value that looked like a
 * finding while having nothing to be a finding against.
 *
 * Warning, not critical. Taking something off a runner is a defensible
 * discretionary act; doing it repeatedly without ever planning to is the habit
 * worth seeing.
 */
export const unplannedPartial: Rule = {
  id: "unplanned_partial",
  level: "trade",
  minSample: 0,
  description:
    "A position reduced mid-hold with no scale-out written when it was opened.",
  evaluate: (ctx) => {
    const out: Insight[] = [];
    for (const e of ctx.trades) {
      // "A plan was written" now means a sentence OR entered rungs. The
      // direction of the widening matters: the predicate makes the rule fire
      // LESS often, never more — no existing insight starts making a new
      // accusation because of this change.
      const written =
        (stringFieldValue(e.trade.row, "scale_out_plan") ?? "").trim() !== "";
      const levelled =
        parseScaleOutLevels(
          (e.trade.row as { scale_out_levels?: unknown }).scale_out_levels,
        ).length > 0;
      if (written || levelled) continue;

      const day = (ctx.checkinsByPosition.get(e.id) ?? []).find(
        (c) => c.touched === "partial_exit",
      );
      if (!day) continue;

      out.push({
        ruleId: "unplanned_partial",
        level: "trade",
        severity: "warning",
        title: "Partial exit with no plan for one",
        detail: `You took part of this off on ${day.report_date}, and no scale-out was written at entry. Outcome: ${rPart(e, ctx.currency)}.`,
        subjectId: e.id,
        subjectLabel: e.label,
      });
    }
    return out;
  },
};

export const SWING_RULES: Rule[] = [
  thesisInvalidatedButHeld,
  pastTimeStop,
  touchedAnIntactThesis,
  unplannedPartial,
  entryWithoutThesis,
  weekendHoldRecord,
];
