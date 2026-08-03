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
  description: "Zelen dan, svi trejdovi dobitni, nijedan nije išao protiv tebe.",
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
          title: "Savršen dan",
          detail: `${d.trades.length} trejdova, ${fmtMoney(
            d.net,
            ctx.currency,
          )}, nijedan nije bio u minusu.`,
        }),
      ),
};

export const highConvictionDay: Rule = {
  id: "high_conviction_day",
  level: "day",
  minSample: 0,
  description: "Jedan trejd, visok R.",
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
          title: "Dan visoke uverenosti",
          detail: `Jedan trejd (${d.trades[0].label}) za ${d.trades[0].r!.toFixed(
            2,
          )}R. Nema šuma.`,
        }),
      ),
};

export const sizingProblemDay: Rule = {
  id: "sizing_problem_day",
  level: "day",
  minSample: 0,
  description:
    "Visok win rate, a dan crven — prosečan gubitak nadmašuje prosečan dobitak.",
  evaluate: (ctx) =>
    ctx.days
      .filter((d) => {
        const decided = d.wins + d.losses;
        if (decided < 2 || d.net >= 0) return false;
        return (d.wins / decided) * 100 >= D.SIZING_PROBLEM_WIN_PCT;
      })
      .map((d) =>
        dayInsight(d, {
          ruleId: "sizing_problem_day",
          severity: "critical",
          title: "Više dobitnika, dan crven",
          detail: `${d.wins}W / ${d.losses}L a rezultat ${fmtMoney(
            d.net,
            ctx.currency,
          )}. Problem je veličina gubitaka, ne izbor trejdova.`,
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
  description: "Obe strane istog dana.",
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
          title: red ? "Menjanje strane, dan crven" : "Menjanje strane, dan zelen",
          detail: red
            ? `${longs} long i ${shorts} short istog dana za ${fmtMoney(
                d.net,
                ctx.currency,
              )} — bias nije bio odlučen.`
            : `${longs} long i ${shorts} short istog dana za ${fmtMoney(
                d.net,
                ctx.currency,
              )}. Prošlo je, ali proveri je li moglo čistije.`,
        });
      }),
};

export const leftMoneyOnTable: Rule = {
  id: "left_money_on_table",
  level: "day",
  minSample: 0,
  description: "Zbir propuštenog pomeraja preko trejdova tog dana.",
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
          title: "Ostavljeno na stolu",
          detail: `${missed.toFixed(
            2,
          )}R neuzeto preko ${counted} trejdova tog dana.`,
        }),
      ),
};

export const overconfidence: Rule = {
  id: "overconfidence",
  level: "day",
  minSample: 0,
  description: "Veličina povećana posle niza dobitaka, pa gubitak.",
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
          title: "Preterano samopouzdanje",
          detail: `Posle ${streak} dobitka zaredom veličina je podignuta sa ${prev.size} na ${e.size} — i trejd je izgubio ${fmtMoney(
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
