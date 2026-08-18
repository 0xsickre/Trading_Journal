"use client";

import { LayoutGrid } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  DASHBOARD_WIDGETS,
  LOCKED_REASON,
  WIDGET_GROUP_LABELS,
  widgetCounts,
  type WidgetGroup,
} from "@/lib/journal/dashboard-widgets";

/**
 * Which sections of the dashboard are on.
 *
 * The same shape as the journal grid's column picker — checkbox items that keep
 * the menu open, a badge carrying visible-of-total — because it is the same
 * gesture and a reader who has learned one should not have to learn the other.
 *
 * The three locked widgets are listed rather than omitted, greyed out with the
 * reason attached. Hiding them from the list would leave a reader who wants
 * the FTMO banner gone hunting for a switch that does not exist; showing the
 * switch disabled answers the question in place.
 */
export function WidgetPicker({
  hidden,
  onToggle,
}: {
  hidden: readonly string[];
  onToggle: (id: string) => void;
}) {
  const counts = widgetCounts(hidden);
  const groups = [...new Set(DASHBOARD_WIDGETS.map((w) => w.group))];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8">
          <LayoutGrid className="size-4" /> Sections
          {counts.visible < counts.total && (
            <Badge variant="secondary" className="ml-1">
              {counts.visible}/{counts.total}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-96 w-64 overflow-y-auto"
      >
        {groups.map((group: WidgetGroup, i) => (
          <div key={group}>
            {i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              {WIDGET_GROUP_LABELS[group]}
            </DropdownMenuLabel>
            {DASHBOARD_WIDGETS.filter((w) => w.group === group).map((w) => (
              <DropdownMenuCheckboxItem
                key={w.id}
                checked={!w.hideable || !hidden.includes(w.id)}
                disabled={!w.hideable}
                title={w.hideable ? undefined : LOCKED_REASON}
                onSelect={(e) => {
                  // Keep the menu open — switching several sections off in a
                  // row is the normal way this gets used.
                  e.preventDefault();
                  onToggle(w.id);
                }}
              >
                {w.label}
              </DropdownMenuCheckboxItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
