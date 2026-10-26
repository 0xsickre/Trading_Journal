import { Suspense } from "react";
import { getAccounts } from "@/lib/journal/accounts";
import { getCashEvents } from "@/lib/journal/cash-events";
import { getDailyReportsLite } from "@/lib/journal/daily-report-queries";
import { getFillCounts, getTradesWithStats } from "@/lib/journal/trades";
import { getFieldDefs } from "@/lib/journal/field-defs";
import { getOptionsMap } from "@/lib/journal/options";
import { getPlaybooks, getPositionRules } from "@/lib/journal/playbooks";
import { ReportsWorkbench } from "@/components/journal/reports/reports-workbench";
import type { TradeRow } from "@/lib/journal/types";
import { PageHeader } from "@/components/app/page-header";
import { getDailyBiases } from "@/lib/journal/daily-bias-queries";
import { ReportsSkeleton } from "@/components/journal/reports/reports-skeleton";
import { getAutoMistakes } from "@/lib/journal/auto-mistakes-queries";
import { getPrimaryAccount } from "@/lib/journal/accounts";
import { todayFor } from "@/lib/journal/time";

export default async function ReportsPage() {
  // `tj_position_rules` is drained ONCE, and the per-rule counts are derived
  // from the result inside `getPlaybooks`. Both reads used to sit in this
  // Promise.all, draining the same table — one row per rule per trade, the
  // fastest-growing in the schema — twice on every render of the route. It is
  // handed to `getPlaybooks` as a PROMISE, so the single drain no longer costs a
  // round trip of its own before everything else starts.
  const positionRulesPromise = getPositionRules();

  const [
    trades,
    accounts,
    dailyReports,
    fillCounts,
    cashEvents,
    fieldDefs,
    playbooks,
    optionsMap,
    positionRules,
    biases,
  ] = await Promise.all([
    getTradesWithStats(),
    getAccounts(),
    getDailyReportsLite(),
    getFillCounts(),
    getCashEvents(),
    // All defs: reports read history, and a retired field's trades still
    // carry its values.
    getFieldDefs(false),
    // Retired rules included for the same reason — their recorded answers are
    // real observations, and dropping them would move numbers for trades logged
    // long before the rule was retired.
    getPlaybooks({ includeDeleted: true, positionRules: positionRulesPromise }),
    // Inactive options included, for the third time and the same reason: an
    // emotion the trader has since retired is still the emotion those trades
    // were tagged with, and dropping it would move a tag from the Emocija
    // dimension into nothing at all.
    getOptionsMap(false),
    positionRulesPromise,
    // Bias dana (phase D): every forecast — the winrates belong to days, not to filtered trades.
    getDailyBiases(),
  ]);

  // Phase B4: every trade's automatic mistakes, for "Sve greške (ručne + auto)".
  const found = await getAutoMistakes("2000-01-01", todayFor(await getPrimaryAccount()));
  const autoMistakes = Object.fromEntries([...found].map(([id, ms]) => [id, ms.map((m) => m.label)]));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reports"
        description="How each group of your trades did — by setup, instrument, day or any tag."
      />

      {/* useSearchParams needs a Suspense boundary to keep the route from
          opting the whole page out of static rendering. */}
      <Suspense fallback={<ReportsSkeleton />}>
        <ReportsWorkbench
          trades={trades as TradeRow[]}
          accounts={accounts}
          dailyReports={dailyReports}
          fillCounts={fillCounts}
          cashEvents={cashEvents}
          fieldDefs={fieldDefs}
          playbooks={playbooks}
          positionRules={positionRules}
          optionsMap={optionsMap}
          biases={biases}
          autoMistakes={autoMistakes}
        />
      </Suspense>
    </div>
  );
}
