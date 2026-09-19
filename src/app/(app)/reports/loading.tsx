import { Skeleton } from "@/components/ui/skeleton";
import { ReportsSkeleton } from "@/components/journal/reports/reports-skeleton";

export default function ReportsLoading() {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-80" />
      </div>
      <ReportsSkeleton />
    </div>
  );
}
