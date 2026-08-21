/**
 * Process insights — the ones TradeZella structurally cannot have.
 *
 * They all join trade outcomes against the daily process journal or against
 * fields that record a decision made before entry (macro alignment, COT filter,
 * setup grade). That join is the whole reason this journal exists: it prices
 * discipline in R instead of describing it in prose.
 */

import { stringFieldValue } from "../field-values";
import { winRateOf } from "../analytics";
import { scorable, setupScoreFromTrade } from "../setup-score";
import { fmtMoney } from "../format";
import { isInterference, TOUCHED_LABELS } from "../position-checkin";
import type { TradeRow } from "../types";
import type { InsightContext } from "./context";
import type { Insight, InsightRule } from "./types";

const P = {
  /** Mental temperature below which entries are flagged. */
  LOW_MENTAL_TEMP: 3,
  /** Swap above this share of gross P&L has eaten the trade. */
  SWAP_SHARE_OF_GROSS: 0.15,
  /** Days a plan may sit unexecuted before it is stale. */
  STALE_PLAN_DAYS: 14,
  /** Trades needed before a category comparison is worth showing. */
  MIN_CATEGORY_SAMPLE: 4,
} as const;

type Rule = InsightRule<InsightContext>;

/** Reads through the field accessor: the value may be a column or a custom one. */
function strField(row: Record<string, unknown>, key: string): string {
  return stringFieldValue(row, key) ?? "";
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Micromanaging an A-setup, priced in R.
 *
 * `dayKeysBetween(openDay, closeDay)` used to be the first half of this rule: it
 * swept every day of the hold and asked the DAILY report whether the day was
 * marked as touched. That answer was about the day, not about this position, so
 * an A-setup left strictly alone was flagged whenever some OTHER position was
 * touched while it happened to be open.
 *
 * The check-in now names its position, so no sweep is needed and no other
 * position's answer can reach this one — the join is on the position id.
 */
export const micromanagedASetup: Rule = {
  id: "micromanaged_a_setup",
  level: "trade",
  minSample: 0,
  description:
    "An A-setup you recorded interfering with while it was open.",
  evaluate: (ctx) => {
    const out: Insight[] = [];
    for (const e of ctx.trades) {
      if (!isASetup(e.trade.row, ctx.rules ? setupScoreFromTrade(scorable(e), ctx.rules) : null))
        continue;

      const touchedOn = (ctx.checkinsByPosition.get(e.id) ?? []).find((c) =>
        isInterference(c.touched),
      );
      if (!touchedOn?.touched) continue;

      const rPart = e.r != null ? `${e.r.toFixed(2)}R` : fmtMoney(e.pnl, ctx.currency);
      out.push({
        ruleId: "micromanaged_a_setup",
        level: "trade",
        severity: "critical",
        title: "Micromanaged an A-setup",
        detail: `On ${touchedOn.report_date} you recorded "${TOUCHED_LABELS[touchedOn.touched].toLowerCase()}" on this A-setup. Outcome: ${rPart}.`,
        subjectId: e.id,
        subjectLabel: e.label,
      });
    }
    return out;
  },
};

/** Entering against the macro bias recorded at the time. */
export const againstMacroBias: Rule = {
  id: "against_macro_bias",
  level: "trade",
  minSample: P.MIN_CATEGORY_SAMPLE,
  description: "An entry against the macro bias, with that category's historical result.",
  evaluate: (ctx) => {
    const against = ctx.trades.filter((e) =>
      norm(strField(e.trade.row, "macro_align")).includes("protiv"),
    );
    if (against.length < P.MIN_CATEGORY_SAMPLE) return [];

    const net = against.reduce((s, e) => s + e.pnl, 0);
    const wins = against.filter((e) => e.outcome === "win").length;
    const losses = against.filter((e) => e.outcome === "loss").length;
    const winPct = winRateOf(wins, losses) ?? 0;

    return [
      {
        ruleId: "against_macro_bias",
        level: "portfolio",
        severity: net < 0 ? "warning" : "info",
        title: "Trades against the macro bias",
        detail: `${against.length} trades against the bias: ${fmtMoney(
          net,
          ctx.currency,
        )}, win rate ${winPct.toFixed(0)} %. ${
          net < 0
            ? "The category is in the red — that is a filter, not an opinion."
            : "The category is positive — the bias is not an absolute ban."
        }`,
        subjectId: "against_macro_bias",
        sample: against.length,
      },
    ];
  },
};

/** Entering after the COT filter said not to chase. */
export const cotChase: Rule = {
  id: "cot_chase",
  level: "trade",
  minSample: 0,
  description: "An entry despite the COT filter saying not to chase.",
  evaluate: (ctx) =>
    ctx.trades
      .filter((e) => norm(strField(e.trade.row, "cot_filter")).includes("ne chase"))
      .map((e) => ({
        ruleId: "cot_chase",
        level: "trade" as const,
        severity: e.outcome === "loss" ? ("warning" as const) : ("info" as const),
        title: "Chased despite the COT filter",
        detail: `The COT filter said "do not chase", and you entered anyway. Outcome: ${
          e.r != null ? `${e.r.toFixed(2)}R` : fmtMoney(e.pnl, ctx.currency)
        }.`,
        subjectId: e.id,
        subjectLabel: e.label,
      })),
};

/** Entering on a day you rated your own head below par. */
export const lowMentalTempEntry: Rule = {
  id: "low_mental_temp_entry",
  level: "trade",
  minSample: 0,
  description: "An entry on a day with mental temperature below the threshold.",
  evaluate: (ctx) => {
    const out: Insight[] = [];
    for (const e of ctx.trades) {
      // The judgement that matters is the one made at ENTRY, so this reads the
      // open day rather than the close day.
      const report = ctx.reportByDate.get(e.openDay);
      const temp = report?.mental_temp;
      if (temp == null || temp >= P.LOW_MENTAL_TEMP) continue;
      out.push({
        ruleId: "low_mental_temp_entry",
        level: "trade",
        severity: e.outcome === "loss" ? "critical" : "warning",
        title: "Entry on a poor mental rating",
        detail: `On the entry day you rated your mental temperature ${temp}/5. Outcome: ${
          e.r != null ? `${e.r.toFixed(2)}R` : fmtMoney(e.pnl, ctx.currency)
        }.`,
        subjectId: e.id,
        subjectLabel: e.label,
      });
    }
    return out;
  },
};

/** A-grade setups that were planned and never taken. */
/**
 * Is this an A-setup?
 *
 * The derived grade wins when it exists; the hand-typed column is the fallback
 * for trades graded before criteria existed. Both are compared against a closed
 * set rather than by prefix, which is how it used to be done — `startsWith("a")`
 * also matched anything a person typed into the editable option list, "Awful"
 * included.
 */
function isASetup(
  row: TradeRow,
  scored: { grade: string } | null,
): boolean {
  const grade = scored?.grade ?? strField(row, "setup_grade") ?? "";
  return grade === "A+" || grade === "A";
}

export const missedASetup: Rule = {
  id: "missed_a_setup",
  level: "portfolio",
  minSample: 0,
  description: "A-setups marked as missed.",
  evaluate: (ctx) => {
    // Missed trades are read from `allRows`, which are raw rows rather than
    // enriched trades, so the derived grade is not reachable here. The hand-typed
    // column is all there is — and a trade that was never taken has no outcome to
    // be graded with hindsight, which is the defect deriving exists to avoid. So
    // this one keeps reading the column, deliberately.
    const missed = ctx.allRows.filter(
      (r) => r.status === "missed" && isASetup(r, null),
    );
    if (missed.length === 0) return [];
    return [
      {
        ruleId: "missed_a_setup",
        level: "portfolio",
        severity: "warning",
        title: "Missed A-setups",
        detail: `${missed.length} A-setups were planned and never executed. No P&L statistic shows this — an execution problem, not a selection one.`,
        subjectId: "missed_a_setup",
        sample: missed.length,
      },
    ];
  },
};

/** Swap that consumed a meaningful share of the gross result. */
export const swapAteTheTrade: Rule = {
  id: "swap_ate_the_trade",
  level: "trade",
  minSample: 0,
  description: "Swap consumed a meaningful share of the gross result.",
  evaluate: (ctx) =>
    ctx.trades
      .filter((e) => {
        // Only a positive swap is a cost — `net_pl` is gross − fees − swap, so a
        // negative value is carry you EARNED and must never read as damage.
        const swap = e.trade.row.stats?.total_swap ?? 0;
        const gross = Math.abs(e.trade.gross);
        return swap > 0 && gross > 0 && swap / gross >= P.SWAP_SHARE_OF_GROSS;
      })
      .map((e) => {
        const swap = e.trade.row.stats?.total_swap ?? 0;
        const share = (Math.abs(swap) / Math.abs(e.trade.gross)) * 100;
        return {
          ruleId: "swap_ate_the_trade",
          level: "trade" as const,
          severity: "warning" as const,
          title: "Swap ate the trade",
          detail: `${fmtMoney(swap, ctx.currency)} of swap on ${fmtMoney(
            e.trade.gross,
            ctx.currency,
          )} gross — ${share.toFixed(0)} %. Holding cost as much as a mistake would have.`,
          subjectId: e.id,
          subjectLabel: e.label,
        };
      }),
};

/** Plans left sitting without a fill. */
export const stalePlan: Rule = {
  id: "stale_plan",
  level: "portfolio",
  minSample: 0,
  description: "Planned trades older than the threshold with no fill at all.",
  evaluate: (ctx) => {
    const now = Date.now();
    const stale = ctx.allRows.filter((r) => {
      if (r.status !== "planned") return false;
      const created = r.created_at ? new Date(r.created_at).getTime() : NaN;
      if (Number.isNaN(created)) return false;
      return (now - created) / 86_400_000 > P.STALE_PLAN_DAYS;
    });
    if (stale.length === 0) return [];
    return [
      {
        ruleId: "stale_plan",
        level: "portfolio",
        severity: "info",
        title: "Plans without execution",
        detail: `${stale.length} plans older than ${P.STALE_PLAN_DAYS} days with no fill at all. Either mark them as missed or close them — dead plans corrupt the missed-setup statistics.`,
        subjectId: "stale_plan",
        sample: stale.length,
      },
    ];
  },
};

export const PROCESS_RULES: Rule[] = [
  micromanagedASetup,
  againstMacroBias,
  cotChase,
  lowMentalTempEntry,
  missedASetup,
  swapAteTheTrade,
  stalePlan,
];
