import { Skeleton } from "@/components/ui/skeleton";

/**
 * The Reports page's shape while it loads — scope bar, report bar, overview,
 * chart, table — so the page does not jump when it arrives. Used by the
 * route's `loading.tsx` and by the Suspense boundary around the workbench.
 */
export function ReportsSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-9 w-52" />
        <Skeleton className="h-9 w-80" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-40" />
      </div>
      <Skeleton className="h-36 w-full" />
      <Skeleton className="h-[22rem] w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
