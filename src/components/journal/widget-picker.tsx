"use client";

import { ChevronDown, ChevronUp, LayoutGrid } from "lucide-react";
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
  LOCKED_REASON,
  canMoveWidget,
  resolveOrder,
  widgetCounts,
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
 *
 * LISTED IN PAGE ORDER, NOT GROUPED BY KIND. Grouping read better while the
 * list only answered "is this on"; now that the same list also answers "what
 * comes after what", any grouping would contradict the arrows sitting beside
 * each row. The list IS the page, top to bottom.
 *
 * The arrows are buttons rather than drag handles. This repo reorders with
 * chevrons everywhere (`moveFieldDef`, `reorderOptions`), carries no
 * drag-and-drop dependency, and knip fails the build on an unused one — but
 * the deciding reason is testability: a chevron is a click, while a pointer
 * sensor in jsdom has to be driven with synthetic events against elements that
 * all measure zero.
 */
export function WidgetPicker({
  hidden,
  order,
  onToggle,
  onMove,
}: {
  hidden: readonly string[];
  order: readonly string[];
  onToggle: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
}) {
  const counts = widgetCounts(hidden);
  const ordered = resolveOrder(order);

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
        className="max-h-96 w-72 overflow-y-auto"
      >
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          In page order. Arrows move a section up or down.
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {ordered.map((w) => (
          <DropdownMenuCheckboxItem
            key={w.id}
            checked={!w.hideable || !hidden.includes(w.id)}
            disabled={!w.hideable}
            title={w.hideable ? undefined : LOCKED_REASON}
            className="pr-1"
            onSelect={(e) => {
              // Keep the menu open — switching several sections off in a row,
              // or nudging one down three places, is the normal way this gets
              // used.
              e.preventDefault();
              onToggle(w.id);
            }}
          >
            <span className="flex-1 truncate">{w.label}</span>
            {w.hideable && (
              // Stops at the item: a chevron inside a checkbox row would
              // otherwise toggle the section on its way past.
              <span
                className="ml-2 flex shrink-0"
                onSelect={(e) => e.stopPropagation()}
              >
                <Chevron
                  dir={-1}
                  disabled={!canMoveWidget(order, w.id, -1)}
                  label={`Move ${w.label} up`}
                  onMove={() => onMove(w.id, -1)}
                />
                <Chevron
                  dir={1}
                  disabled={!canMoveWidget(order, w.id, 1)}
                  label={`Move ${w.label} down`}
                  onMove={() => onMove(w.id, 1)}
                />
              </span>
            )}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Chevron({
  dir,
  disabled,
  label,
  onMove,
}: {
  dir: -1 | 1;
  disabled: boolean;
  label: string;
  onMove: () => void;
}) {
  const Icon = dir === -1 ? ChevronUp : ChevronDown;
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onMove();
      }}
      /*
       * POINTER EVENTS ARE STOPPED, NOT JUST THE CLICK, and that took a test to
       * find. A Radix menu item selects on `pointerup` — before any `click`
       * handler on a child runs — so stopping the click alone let every reorder
       * also switch the section off. Both ends of the gesture have to be caught.
       */
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
    >
      <Icon className="size-3.5" />
    </button>
  );
}
