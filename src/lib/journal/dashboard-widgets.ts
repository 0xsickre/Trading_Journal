/**
 * What the dashboard is made of, as a list the reader can switch on and off.
 *
 * THE UNIT IS A SECTION, NOT A TILE, and that is the whole design. Thirty-odd
 * tile checkboxes would be a picker that reproduces the problem it exists to
 * solve; eighteen sections fit in one popover and match what a reader actually
 * resents — a whole band of the page, never one number in it. The three stat
 * groups already have their own fold, so per-tile visibility would be a second
 * mechanism for the same thing over the same DOM.
 *
 * Modelled on `reports/metrics.ts`: a flat array, a Map-backed lookup, and no
 * behaviour beyond describing what exists. The rendering lives in the dashboard
 * and the storage lives in `dashboard-prefs.ts`; this file is what they agree
 * about.
 */

export type WidgetGroup = "headline" | "detail" | "charts" | "process";

export type DashboardWidget = {
  /**
   * Stable key. Renaming one makes every stored preference forget it, which
   * shows the widget again rather than hiding it — the safe direction, and the
   * same rule `StatGroup` ids follow.
   */
  id: string;
  label: string;
  group: WidgetGroup;
  /**
   * False for the three sections a preference must not be able to switch off.
   * See `LOCKED_REASON`.
   */
  hideable: boolean;
};

/**
 * Why three widgets refuse to be hidden.
 *
 * Two of them are warnings about the reader's own money: the FTMO banner
 * announces a prop-firm breach, and the unpriced-trades notice says *the
 * numbers on this page are incomplete*. A display preference must not be able
 * to silence either — a page that can be configured into lying is worse than a
 * page with no configuration at all.
 *
 * The third is the headline row. Hiding it would leave a dashboard whose first
 * screen is a fold and a filter bar, and `column-prefs.ts` already settled the
 * general form of this argument with `MIN_VISIBLE_COLUMNS`: some toggles simply
 * refuse.
 */
export const LOCKED_REASON =
  "Warnings about the account and the headline figures cannot be hidden.";

export const DASHBOARD_WIDGETS: DashboardWidget[] = [
  // Locked.
  { id: "ftmo", label: "Challenge status", group: "headline", hideable: false },
  { id: "unpriced", label: "Incomplete-data warning", group: "headline", hideable: false },
  { id: "headline", label: "Headline figures", group: "headline", hideable: false },

  { id: "detail-tiles", label: "Result and risk — detail", group: "detail", hideable: true },

  { id: "equity", label: "Equity curve", group: "charts", hideable: true },
  { id: "score", label: "Sickre Score", group: "charts", hideable: true },
  { id: "insights", label: "Automated insights", group: "process", hideable: true },
  { id: "tracker", label: "Process consistency", group: "process", hideable: true },

  { id: "hold-time", label: "Hold time", group: "detail", hideable: true },
  { id: "costs", label: "Costs", group: "detail", hideable: true },
  { id: "plan-vs-reality", label: "Plan vs reality", group: "detail", hideable: true },
  { id: "weekly", label: "Weekly performance", group: "detail", hideable: true },
  { id: "monthly", label: "Monthly performance", group: "detail", hideable: true },

  { id: "r-distribution", label: "R-multiple distribution", group: "charts", hideable: true },
  { id: "drawdown", label: "Drawdown curve", group: "charts", hideable: true },
  { id: "calendar", label: "Daily P/L calendar", group: "charts", hideable: true },
  { id: "execution-quality", label: "Slippage and target attainment", group: "charts", hideable: true },
  { id: "tag-breakdown", label: "Performance by tag", group: "detail", hideable: true },
];

export const WIDGET_GROUP_LABELS: Record<WidgetGroup, string> = {
  headline: "Always on",
  detail: "Detail",
  charts: "Charts",
  process: "Process",
};

/** Registry order, which is also the order the page renders in. */
export const WIDGET_IDS: string[] = DASHBOARD_WIDGETS.map((w) => w.id);

const BY_ID = new Map(DASHBOARD_WIDGETS.map((w) => [w.id, w]));

export function getWidget(id: string): DashboardWidget | undefined {
  return BY_ID.get(id);
}

/**
 * The set of widget ids to render, from the stored hidden set.
 *
 * TOTAL BY CONSTRUCTION: any stored value at all — a stale id from a renamed
 * widget, a hand-edited array, an id that has never existed — produces a
 * renderable page. Unknown ids are inert and locked widgets are visible no
 * matter what the store says, so the two ways a preference could blank the
 * dashboard are both closed here rather than only in the UI.
 */
export function visibleWidgets(hidden: readonly string[]): Set<string> {
  const off = new Set(hidden);
  return new Set(
    DASHBOARD_WIDGETS.filter((w) => !w.hideable || !off.has(w.id)).map(
      (w) => w.id,
    ),
  );
}

/**
 * Toggle one widget, refusing every move that is not allowed.
 *
 * Enforced here and not only in the popover, so the rule holds however the
 * toggle is driven — the same reason `toggleHidden` in `column-prefs.ts`
 * refuses to empty the grid rather than trusting its caller.
 */
export function toggleWidget(
  hidden: readonly string[],
  id: string,
): string[] {
  const w = getWidget(id);
  // Unknown or locked: the stored set is returned untouched, so a caller that
  // asks for something impossible gets a no-op instead of a corrupted array.
  if (!w || !w.hideable) return [...hidden];

  const off = new Set(hidden);
  if (off.has(id)) off.delete(id);
  else off.add(id);

  // Ordered by the registry so the same selection always stores the same array
  // — two identical dashboards must not differ by the order somebody clicked.
  return WIDGET_IDS.filter((k) => off.has(k));
}

/** How many hideable widgets are currently on, and how many there are. */
export function widgetCounts(hidden: readonly string[]): {
  visible: number;
  total: number;
} {
  const off = new Set(hidden);
  const hideable = DASHBOARD_WIDGETS.filter((w) => w.hideable);
  return {
    visible: hideable.filter((w) => !off.has(w.id)).length,
    total: hideable.length,
  };
}
