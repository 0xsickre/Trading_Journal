"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getDashboardPrefs,
  setDashboardPrefs,
  toggleCollapsed,
} from "@/lib/journal/dashboard-prefs";

/**
 * A titled, collapsible block of KPI tiles.
 *
 * OPEN IS THE ONLY SAFE INITIAL STATE, and not merely as a default — as an
 * invariant. `useState(false)` runs identically on the server and on the first
 * client render, and the stored preference is applied in an effect afterwards.
 * Reading `localStorage` during render instead would give the server one answer
 * and the browser another, which is a hydration mismatch; it would also mean a
 * headless render (every component test in this repo) could observe a collapsed
 * group and so fail to find a tile that is genuinely on the page.
 *
 * The reason that matters here more than usual: `dashboard.render.test.tsx`
 * asserts nine KPI values by text, several of which live inside these groups.
 * Those assertions are the guard that the numbers on screen are the numbers the
 * book computes — a collapsed-by-default group would disable them silently.
 */
export function StatGroup({
  id,
  title,
  count,
  children,
}: {
  /** Stable key for the stored preference. Renaming one re-opens that group. */
  id: string;
  title: string;
  /** Tile count, shown while collapsed so the block still says what it holds. */
  count: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const collapsed = getDashboardPrefs().collapsedGroups ?? [];
    if (collapsed.includes(id)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- external-store init
      setOpen(false);
    }
  }, [id]);

  function toggle() {
    const next = !open;
    setOpen(next);
    const collapsed = getDashboardPrefs().collapsedGroups ?? [];
    setDashboardPrefs({ collapsedGroups: toggleCollapsed(collapsed, id) });
  }

  return (
    <section className="space-y-2">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left"
      >
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open ? "" : "-rotate-90",
          )}
        />
        <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
        <span className="text-xs text-muted-foreground/70">{count}</span>
        <span className="ml-2 h-px flex-1 bg-border" />
      </button>

      {open && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {children}
        </div>
      )}
    </section>
  );
}
