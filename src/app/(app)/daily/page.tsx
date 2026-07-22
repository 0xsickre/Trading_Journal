import { getPrimaryAccount } from "@/lib/journal/accounts";
import { getDailyReport } from "@/lib/journal/daily-report-queries";
import { todayInTz } from "@/lib/journal/daily-report";
import { getActiveFocusGoal } from "@/lib/journal/focus-goal-queries";
import { FocusGoalCard } from "@/components/journal/focus-goal-card";
import { DailyReportForm } from "@/components/journal/daily-report-form";

export default async function DailyPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date: dateParam } = await searchParams;
  const account = await getPrimaryAccount();
  const timezone = account?.timezone ?? "America/New_York";
  const today = todayInTz(timezone);

  const reportDate =
    dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
      ? dateParam > today
        ? today
        : dateParam
      : today;

  const [report, activeGoal] = await Promise.all([
    getDailyReport(reportDate),
    getActiveFocusGoal(),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Daily Report</h1>
        <p className="text-muted-foreground">
          Process and discipline journal — grade your day on focus-goal progress,
          not P&amp;L.
        </p>
      </div>

      <FocusGoalCard goal={activeGoal} reportDate={reportDate} />

      <DailyReportForm
        key={reportDate}
        report={report}
        reportDate={reportDate}
        today={today}
        timezone={timezone}
        activeGoal={activeGoal}
      />
    </div>
  );
}
