import Link from "next/link";
import { CalendarDays, List } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Grid or list, in the URL rather than in state.
 *
 * A query param and not a `useState` for the reason `/reports` keeps `?dim=` in
 * the URL: the choice survives a reload, a back button and a pasted link. It
 * also keeps both views renderable on the server, which a client toggle would
 * have forced open by making the page hold both trees at once.
 *
 * The month rides along so switching view does not throw the reader back to
 * this month.
 */
export function CalendarViewToggle({
  monthKey,
  view,
}: {
  monthKey: string;
  view: "grid" | "list";
}) {
  return (
    <div className="flex gap-1">
      <Button
        variant={view === "grid" ? "default" : "outline"}
        size="sm"
        className="h-8"
        asChild
      >
        <Link href={`/calendar?month=${monthKey}`}>
          <CalendarDays className="size-4" /> Grid
        </Link>
      </Button>
      <Button
        variant={view === "list" ? "default" : "outline"}
        size="sm"
        className="h-8"
        asChild
      >
        <Link href={`/calendar?month=${monthKey}&view=list`}>
          <List className="size-4" /> List
        </Link>
      </Button>
    </div>
  );
}
