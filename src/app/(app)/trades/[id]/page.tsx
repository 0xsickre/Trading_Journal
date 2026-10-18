import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCategoryOrder, getOptionsMap } from "@/lib/journal/options";
import { getAccounts } from "@/lib/journal/accounts";
import { getFieldDefs } from "@/lib/journal/field-defs";
import { getPlaybooks, getTradeRuleAnswers } from "@/lib/journal/playbooks";
import { getTradeScenario } from "@/lib/journal/trades";
import { stopStatus } from "@/lib/journal/stop-moved";
import { excursionFromTrade } from "@/lib/journal/excursion";
import { resolveBreakevenRange } from "@/lib/journal/breakeven";
import { fieldValue } from "@/lib/journal/field-values";
import { autoExitReason } from "@/lib/journal/quick-log";
import { DAY_TIME, DEFAULT_TZ, accountDayZone, dayKeyIn, fmtInTz } from "@/lib/journal/time";
import { rootOf } from "@/lib/journal/default-instruments";
import { BIAS_CARD_SINCE, BIAS_LABEL, biasLateText, biasesOf } from "@/lib/journal/daily-bias";
import { getDailyBiases } from "@/lib/journal/daily-bias-queries";
import type { FieldDef } from "@/lib/journal/field-def-types";
import type { TradeRow } from "@/lib/journal/types";
import { PageHeader } from "@/components/app/page-header";
import { TradePage, type TradePageTrade } from "@/components/journal/trade-page";
import type { CategoryValue } from "@/components/journal/category-field";
import { TradeImages } from "@/components/journal/trade-images";
import { TradeScenarioCard } from "@/components/journal/trade-scenario-card";

const nums = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

function categoryValue(v: unknown): CategoryValue {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (v == null || v === "") return null;
  return String(v);
}

/**
 * One page per trade (phase P): the trade as the import brought it, the stop and
 * what was said off the recording, setup and checklist, the trader's categories
 * and the review. `/trades/[id]/edit` and `/trades/[id]/review` redirect here.
 */
export default async function TradeRoute({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  const { from } = await searchParams;
  const supabase = await createClient();
  const [{ data: pos }, { data: stats }, ruleAnswers, optionsMap, accounts, playbooks, defs, categoryOrder, scenario] =
    await Promise.all([
      supabase.from("tj_positions").select("*").eq("id", id).maybeSingle(),
      supabase
        .from("tj_position_stats")
        .select(
          "avg_entry, avg_exit, entry_qty, net_pl, realized_r, total_fees, opened_at, closed_at, duration_seconds, point_value, fx_rate, tick_size, account_currency",
        )
        .eq("position_id", id)
        .maybeSingle(),
      getTradeRuleAnswers(id),
      getOptionsMap(true),
      getAccounts(),
      // Everything: this trade may name a setup since retired.
      getPlaybooks({ activeOnly: false, includeDeleted: true }),
      // Retired definitions too: an old trade keeps the value it was recorded with.
      getFieldDefs(false),
      getCategoryOrder(),
      getTradeScenario(id),
    ]);
  if (!pos) notFound();

  const row = { ...pos, stats } as unknown as TradeRow;
  const account = accounts.find((a) => a.id === pos.account_id) ?? null;
  const missed = pos.status === "missed";
  const moved = missed ? null : stopStatus(row);
  const excursion = excursionFromTrade(row);

  // Which categories the page asks, and where: setup context, or the review.
  const hasValue = (d: FieldDef) => categoryValue(fieldValue(pos, d.key)) != null;
  const shown = (d: FieldDef) => d.is_active || hasValue(d);
  const rank = (d: FieldDef) => categoryOrder[d.list_key ?? ""] ?? Number.MAX_SAFE_INTEGER;
  const ordered = [...defs].sort((a, b) => rank(a) - rank(b) || a.sort_order - b.sort_order || a.key.localeCompare(b.key));
  // Bias dana (phase D, D-6): from the card on, the trade inherits the day's first forecast for its
  // root and the page stops asking. The old field stays in the row for history.
  const biasRoot = missed ? null : rootOf(pos.instrument);
  const openDay = stats?.opened_at ? dayKeyIn(stats.opened_at, account ? accountDayZone(account) : DEFAULT_TZ) : null;
  const fromCard = biasRoot != null && openDay != null && openDay >= BIAS_CARD_SINCE;
  let biasNote: string | null = null;
  if (fromCard) {
    const first = biasesOf(await getDailyBiases(openDay, openDay), openDay, biasRoot)[0];
    const late = first ? biasLateText(first, stats?.opened_at ?? null) : null;
    biasNote = first
      ? `Bias dana (${biasRoot}, sa kartice na /daily): ${BIAS_LABEL[first.bias]}, upisano ${fmtInTz(first.setAt, DEFAULT_TZ, "HH:mm")}${
          late ? ` — posle ovog ulaza, ne broji se` : ""
        }${first.reason ? `. ${first.reason}` : ""}`
      : `Bias dana (${biasRoot}): nije upisan na kartici pre ovog ulaza.`;
  }
  const contextDefs = ordered.filter(
    (d) =>
      shown(d) &&
      (d.show_phase === "always" || d.show_phase === (missed ? "missed" : "planned")) &&
      !(fromCard && d.key === "htf_bias"),
  );
  const reviewDefs = missed ? [] : ordered.filter((d) => shown(d) && d.show_phase === "active");

  const categories: Record<string, CategoryValue> = {};
  for (const d of [...contextDefs, ...reviewDefs]) categories[d.key] = categoryValue(fieldValue(pos, d.key));
  if (!missed && reviewDefs.some((d) => d.key === "exit_reason") && categories.exit_reason == null) {
    categories.exit_reason = autoExitReason({
      direction: pos.direction,
      entry: nums(stats?.avg_entry),
      exit: nums(stats?.avg_exit),
      stop: nums(pos.stop_price),
      target: nums(pos.target_price),
      tickSize: nums(stats?.tick_size),
      options: (optionsMap.exit_reason ?? []).map((o) => o.value),
    });
  }

  const label = `${pos.trade_no != null ? `#${pos.trade_no}` : pos.id.slice(0, 8)}${pos.instrument ? ` ${pos.instrument}` : ""}`;
  const trade: TradePageTrade = {
    id: pos.id,
    label,
    missed,
    accountName: account?.name ?? null,
    currency: stats?.account_currency ?? account?.currency ?? "USD",
    direction: pos.direction,
    qty: nums(stats?.entry_qty),
    avgEntry: nums(stats?.avg_entry),
    avgExit: nums(stats?.avg_exit),
    opened: stats?.opened_at ? fmtInTz(stats.opened_at, DEFAULT_TZ, DAY_TIME) : null,
    closed: stats?.closed_at ? fmtInTz(stats.closed_at, DEFAULT_TZ, DAY_TIME) : null,
    durationSeconds: nums(stats?.duration_seconds),
    netPl: nums(stats?.net_pl),
    realizedR: nums(stats?.realized_r),
    fees: nums(stats?.total_fees),
    maeR: excursion.maeR,
    mfeR: excursion.mfeR,
    riskBudget: nums(pos.risk_budget_at_entry),
    pointValue: nums(stats?.point_value),
    fxRate: nums(stats?.fx_rate),
    tickSize: nums(stats?.tick_size),
    stop: nums(pos.stop_price),
    target: nums(pos.target_price),
    finalStop: nums(pos.final_stop_price),
    stopNote:
      moved === "moved_be"
        ? "Poslednji stop u platformi je na ulazu ili u profitu — pomeren je. Upiši originalni sa snimka."
        : moved === "moved_mae"
          ? "Cena je otišla dalje od poslednjeg stopa, a trejd nije izbačen — stop je pomeren. Upiši originalni sa snimka."
          : null,
    thesis: pos.thesis,
    playbookId: pos.playbook_id,
    ruleAnswers,
    rating: nums(pos.execution_rating),
    notes: pos.trade_journal_notes,
    categories,
    plannedEntry: missed ? nums(pos.entry_price) : null,
    seenAt: missed ? pos.missed_at : null,
    timezone: account?.timezone ?? DEFAULT_TZ,
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title={missed ? "Propušten setup" : "Trejd"}
        description={
          missed
            ? "Nivoi, setup i razlog — ishod iz sveća stiže uveče."
            : "Fill-ovi su iz uvoza i ne menjaju se. Sa snimka: originalni stop, cilj i šta si rekao pre klika; pa setup, kontekst i review."
        }
      />
      <TradePage
        trade={trade}
        playbooks={playbooks}
        contextDefs={contextDefs}
        biasNote={biasNote}
        reviewDefs={reviewDefs}
        optionsMap={optionsMap}
        breakevenRange={resolveBreakevenRange(account)}
        backHref={from === "daily" ? "/daily" : "/journal"}
        images={<TradeImages positionId={pos.id} />}
        scenario={scenario ? <TradeScenarioCard trade={scenario} /> : null}
      />
    </div>
  );
}
