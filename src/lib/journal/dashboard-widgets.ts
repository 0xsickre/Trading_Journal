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

/**
 * Width in quarters of a row.
 *
 * Four units to a row, so a `4` is full width, a `2` is half and a `1` is one
 * of four cards. Expressed as a share rather than as a pixel width because the
 * row it lands in is not known until the reader has finished reordering — see
 * `packRows`.
 */
export type WidgetSpan = 1 | 2 | 4;

export type DashboardWidget = {
  /**
   * Stable key. Renaming one makes every stored preference forget it, which
   * shows the widget again rather than hiding it — the safe direction, and the
   * same rule `StatGroup` ids follow.
   */
  id: string;
  label: string;
  group: WidgetGroup;
  /** Quarters of a row this widget occupies. See `WidgetSpan`. */
  span: WidgetSpan;
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

/**
 * The page, top to bottom, in its default order.
 *
 * REGISTRY ORDER IS THE DEFAULT LAYOUT, so the spans below reproduce exactly
 * what the dashboard looked like before it was rendered from this list: the
 * equity curve beside the score, the four small cards in one row of four. Those
 * adjacencies were the author's argument — "the verdict beside the shape that
 * produced it" — and they survive here as a DEFAULT rather than as a law, which
 * is the honest status for a page the reader is now free to rearrange.
 */
export const DASHBOARD_WIDGETS: DashboardWidget[] = [
  // Locked.
  { id: "ftmo", label: "Challenge status", group: "headline", span: 4, hideable: false },
  { id: "unpriced", label: "Incomplete-data warning", group: "headline", span: 4, hideable: false },
  { id: "headline", label: "Headline figures", group: "headline", span: 4, hideable: false },

  { id: "detail-tiles", label: "Result and risk — detail", group: "detail", span: 4, hideable: true },

  { id: "equity", label: "Equity curve", group: "charts", span: 2, hideable: true },
  { id: "score", label: "Sickre Score", group: "charts", span: 2, hideable: true },
  // What is on right now, and what just happened — the two lists a session
  // opens on, each one click from the trade itself.
  { id: "open-positions", label: "Open positions", group: "detail", span: 2, hideable: true },
  { id: "recent-trades", label: "Recent trades", group: "detail", span: 2, hideable: true },
  { id: "insights", label: "Automated insights", group: "process", span: 4, hideable: true },
  { id: "tracker", label: "Process consistency", group: "process", span: 4, hideable: true },

  { id: "hold-time", label: "Hold time", group: "detail", span: 1, hideable: true },
  { id: "costs", label: "Costs", group: "detail", span: 1, hideable: true },
  { id: "plan-vs-reality", label: "Plan vs reality", group: "detail", span: 1, hideable: true },
  { id: "weekly", label: "Weekly performance", group: "detail", span: 1, hideable: true },
  { id: "monthly", label: "Monthly performance", group: "detail", span: 2, hideable: true },

  { id: "r-distribution", label: "R-multiple distribution", group: "charts", span: 2, hideable: true },
  { id: "drawdown", label: "Drawdown curve", group: "charts", span: 2, hideable: true },
  { id: "calendar", label: "Daily P/L calendar", group: "charts", span: 2, hideable: true },
  { id: "execution-quality", label: "Slippage and target attainment", group: "charts", span: 4, hideable: true },
  { id: "tag-breakdown", label: "Performance by tag", group: "detail", span: 4, hideable: true },
];

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

/**
 * The registry in the reader's stored order.
 *
 * TOTAL, like `visibleWidgets` and for the same reasons. Ids the registry no
 * longer knows are dropped, and registry ids the stored order never mentioned
 * are appended in registry order — so neither a widget renamed in a release nor
 * one added in it can leave the page short a section. An empty stored order is
 * the normal state and means "the default", not "nothing".
 *
 * LOCKED WIDGETS ALWAYS COME FIRST, whatever the stored array says. They are
 * drawn above the rows and never inside them, so a resolved order that placed
 * them anywhere else would describe a page that cannot exist — and the picker,
 * which renders straight from this list, would show "Always on" rows floating
 * in the middle of the sequence.
 */
export function resolveOrder(
  order: readonly string[],
  registry: readonly DashboardWidget[] = DASHBOARD_WIDGETS,
): DashboardWidget[] {
  const known = new Map(registry.map((w) => [w.id, w]));
  const placed: DashboardWidget[] = [];
  const seen = new Set<string>();

  for (const w of registry) {
    if (w.hideable) continue;
    placed.push(w);
    seen.add(w.id);
  }

  for (const id of order) {
    const w = known.get(id);
    if (!w || seen.has(id)) continue;
    seen.add(id);
    placed.push(w);
  }
  for (const w of registry) {
    if (!seen.has(w.id)) placed.push(w);
  }
  return placed;
}

/** Quarters in one row. */
const ROW_UNITS = 4;

/**
 * Widgets grouped into rows, filling each to four quarters.
 *
 * Greedy and order-preserving: a widget goes in the current row if it still
 * fits, and opens a new one if it does not. That is what makes reordering mean
 * something — moving a half-width chart next to another half-width chart pairs
 * them, and moving it next to a full-width one pushes it onto its own line.
 * Nothing is ever reordered to make a tidier fit, because the reader's sequence
 * is the one thing this function must not second-guess.
 */
export function packRows(
  widgets: readonly DashboardWidget[],
): DashboardWidget[][] {
  const rows: DashboardWidget[][] = [];
  let row: DashboardWidget[] = [];
  let used = 0;

  for (const w of widgets) {
    if (used + w.span > ROW_UNITS && row.length > 0) {
      rows.push(row);
      row = [];
      used = 0;
    }
    row.push(w);
    used += w.span;
  }
  if (row.length > 0) rows.push(row);
  return rows;
}

/**
 * One widget moved a place, as a FULL canonical order.
 *
 * Never a swap of two positions in a sparse array: the stored order is usually
 * empty — meaning "the registry's" — and a sparse edit of an empty array cannot
 * express a move at all. Materializing the whole sequence first is the same
 * reasoning `moveFieldDef` follows when it rewrites a group's ordinals rather
 * than swapping two of them.
 *
 * LOCKED WIDGETS ARE SKIPPED, not swapped with. They render above the rows and
 * never inside them, so trading places with one would move the array and change
 * nothing on screen — a button that visibly does nothing is worse than one that
 * is unavailable. Moving a locked widget is refused outright, and moving past
 * one steps over it.
 */
export function moveWidget(
  order: readonly string[],
  id: string,
  direction: -1 | 1,
): string[] {
  const resolved = resolveOrder(order);
  const asIds = () => resolved.map((w) => w.id);

  const target = getWidget(id);
  if (!target || !target.hideable) return asIds();

  const movable = resolved.filter((w) => w.hideable);
  const from = movable.findIndex((w) => w.id === id);
  const to = from + direction;
  // Clamped at both ends rather than wrapping: a widget at the top that jumps
  // to the bottom on one more click is a surprise, not a feature.
  if (from < 0 || to < 0 || to >= movable.length) return asIds();

  const next = [...movable];
  [next[from], next[to]] = [next[to], next[from]];

  // Locked ones keep the front. They are drawn above the rows regardless, so
  // their position in this array is bookkeeping rather than layout.
  return [
    ...resolved.filter((w) => !w.hideable).map((w) => w.id),
    ...next.map((w) => w.id),
  ];
}

/** Whether `id` can still move that way — for greying out the chevron. */
export function canMoveWidget(
  order: readonly string[],
  id: string,
  direction: -1 | 1,
): boolean {
  const w = getWidget(id);
  if (!w || !w.hideable) return false;
  const movable = resolveOrder(order).filter((x) => x.hideable);
  const from = movable.findIndex((x) => x.id === id);
  const to = from + direction;
  return from >= 0 && to >= 0 && to < movable.length;
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
