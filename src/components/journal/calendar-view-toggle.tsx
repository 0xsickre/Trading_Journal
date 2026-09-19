"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { calendarHref, type CalendarView } from "@/lib/journal/calendar-view";

/**
 * Grid or list, and which account — in the URL rather than in state.
 *
 * A query param and not a `useState` for the reason `/reports` keeps `?dim=` in
 * the URL: the choice survives a reload, a back button and a pasted link. It
 * also keeps both views renderable on the server.
 *
 * Every link goes through `calendarHref`, so switching one thing keeps the
 * others — the month, the view, the account.
 */
export function CalendarViewToggle({
  monthKey,
  view,
  accountId = "all",
  accounts = [],
  allowAll = true,
}: {
  monthKey: string;
  view: CalendarView;
  accountId?: string;
  accounts?: { value: string; label: string }[];
  /** False when the accounts' currencies differ and cannot be pooled. */
  allowAll?: boolean;
}) {
  const router = useRouter();
  const href = (v: CalendarView) => calendarHref({ month: monthKey, view: v, account: accountId });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-1">
        <Button variant={view === "grid" ? "default" : "outline"} size="sm" className="h-8" asChild>
          <Link href={href("grid")}>
            <CalendarDays className="size-4" /> Grid
          </Link>
        </Button>
        <Button variant={view === "list" ? "default" : "outline"} size="sm" className="h-8" asChild>
          <Link href={href("list")}>
            <List className="size-4" /> List
          </Link>
        </Button>
      </div>
      {accounts.length > 1 && (
        <Select
          value={accountId}
          onValueChange={(v) =>
            router.push(calendarHref({ month: monthKey, view, account: v }))
          }
        >
          <SelectTrigger className="h-8 w-44" aria-label="Account">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {allowAll && <SelectItem value="all">All accounts</SelectItem>}
            {accounts.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
