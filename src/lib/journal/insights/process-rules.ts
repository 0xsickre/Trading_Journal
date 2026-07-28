/**
 * Process insights — the ones TradeZella structurally cannot have.
 *
 * They all join trade outcomes against the daily process journal or against
 * fields that record a decision made before entry (macro alignment, COT filter,
 * setup grade). That join is the whole reason this journal exists: it prices
 * discipline in R instead of describing it in prose.
 */

import { fmtMoney } from "../format";
import type { InsightContext } from "./context";
import type { Insight, InsightRule } from "./types";

export const P = {
  /** Mental temperature below which entries are flagged. */
  LOW_MENTAL_TEMP: 5,
  /** Swap above this share of gross P&L has eaten the trade. */
  SWAP_SHARE_OF_GROSS: 0.15,
  /** Days a plan may sit unexecuted before it is stale. */
  STALE_PLAN_DAYS: 14,
  /** Trades needed before a category comparison is worth showing. */
  MIN_CATEGORY_SAMPLE: 4,
} as const;

type Rule = InsightRule<InsightContext>;

function strField(row: Record<string, unknown>, key: string): string {
  const v = row[key];
  return typeof v === "string" ? v : "";
}

const norm = (s: string) => s.trim().toLowerCase();

/** Calendar days from `from` to `to` inclusive, as yyyy-MM-dd keys. */
export function dayKeysBetween(from: string, to: string): string[] {
  if (!from || !to || from > to) return from ? [from] : [];
  const out: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) return [];
  // Guard against a pathological range producing an unbounded loop.
  for (let i = 0; cursor <= end && i < 3_650; i++) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

/** Micromanaging an A-setup, priced in R. */
export const micromanagedASetup: Rule = {
  id: "micromanaged_a_setup",
  level: "trade",
  minSample: 0,
  description:
    "A-setup koji je bio otvoren nekog dana kad si upisao da si dirao poziciju.",
  evaluate: (ctx) => {
    const out: Insight[] = [];
    for (const e of ctx.trades) {
      const grade = norm(strField(e.trade.row, "setup_grade"));
      if (!grade.startsWith("a")) continue;

      // Micromanaging happens while the position is OPEN, so the whole holding
      // window is checked. Looking only at the close day would miss every swing
      // trade that was interfered with mid-hold — which is most of them.
      const violatedOn = dayKeysBetween(e.openDay, e.closeDay).find(
        (day) => ctx.reportByDate.get(day)?.micromanage === "violated",
      );
      if (!violatedOn) continue;

      const rPart = e.r != null ? `${e.r.toFixed(2)}R` : fmtMoney(e.pnl, ctx.currency);
      out.push({
        ruleId: "micromanaged_a_setup",
        level: "trade",
        severity: "critical",
        title: "Micromanage na A-setup-u",
        detail: `A-setup je bio otvoren ${violatedOn}, na dan kad si sam upisao da si dirao poziciju. Ishod: ${rPart}.`,
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
  description: "Ulaz protiv makro bias-a, sa istorijskim rezultatom te kategorije.",
  evaluate: (ctx) => {
    const against = ctx.trades.filter((e) =>
      norm(strField(e.trade.row, "macro_align")).includes("protiv"),
    );
    if (against.length < P.MIN_CATEGORY_SAMPLE) return [];

    const net = against.reduce((s, e) => s + e.pnl, 0);
    const wins = against.filter((e) => e.outcome === "win").length;
    const losses = against.filter((e) => e.outcome === "loss").length;
    const decided = wins + losses;
    const winPct = decided > 0 ? (wins / decided) * 100 : 0;

    return [
      {
        ruleId: "against_macro_bias",
        level: "portfolio",
        severity: net < 0 ? "warning" : "info",
        title: "Trejdovi protiv makro bias-a",
        detail: `${against.length} trejdova protiv bias-a: ${fmtMoney(
          net,
          ctx.currency,
        )}, win rate ${winPct.toFixed(0)} %. ${
          net < 0
            ? "Kategorija je u minusu — to je filter, ne mišljenje."
            : "Kategorija je pozitivna — bias nije apsolutna zabrana."
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
  description: "Ulaz uprkos COT filteru koji je rekao da se ne juri.",
  evaluate: (ctx) =>
    ctx.trades
      .filter((e) => norm(strField(e.trade.row, "cot_filter")).includes("ne chase"))
      .map((e) => ({
        ruleId: "cot_chase",
        level: "trade" as const,
        severity: e.outcome === "loss" ? ("warning" as const) : ("info" as const),
        title: "Chase uprkos COT filteru",
        detail: `COT filter je bio „ne chase", a ušao si svejedno. Ishod: ${
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
  description: "Ulaz na dan sa mentalnom temperaturom ispod praga.",
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
        title: "Ulaz na lošu mentalnu ocenu",
        detail: `Na dan ulaska ocenio si mentalnu temperaturu ${temp}/10. Ishod: ${
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
export const missedASetup: Rule = {
  id: "missed_a_setup",
  level: "portfolio",
  minSample: 0,
  description: "A-setup-i označeni kao propušteni.",
  evaluate: (ctx) => {
    const missed = ctx.allRows.filter(
      (r) =>
        r.status === "missed" &&
        norm(String(r.setup_grade ?? "")).startsWith("a"),
    );
    if (missed.length === 0) return [];
    return [
      {
        ruleId: "missed_a_setup",
        level: "portfolio",
        severity: "warning",
        title: "Propušteni A-setup-i",
        detail: `${missed.length} A-setup-a je planirano i nikad izvršeno. Nijedna P&L statistika to ne pokazuje — problem izvršenja, ne izbora.`,
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
  description: "Swap je pojeo znatan deo bruto rezultata.",
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
          title: "Swap je pojeo trejd",
          detail: `${fmtMoney(swap, ctx.currency)} swapa na ${fmtMoney(
            e.trade.gross,
            ctx.currency,
          )} bruto — ${share.toFixed(0)} %. Držanje je koštalo koliko i greška.`,
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
  description: "Planirani trejdovi stariji od praga bez ijednog fill-a.",
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
        title: "Planovi bez izvršenja",
        detail: `${stale.length} plana starijih od ${P.STALE_PLAN_DAYS} dana bez ijednog fill-a. Ili ih označi kao propuštene, ili ih zatvori — mrtvi planovi kvare statistiku propuštenog.`,
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
