/**
 * Which dashboard KPI groups the reader has collapsed.
 *
 * Same shape and the same three defences as `trade-form-prefs.ts` — the SSR
 * guard, the parse guard, and the swallowed write — because this is the same
 * problem: a display preference that belongs to the browser, not to the account,
 * and must never be able to break the page it decorates.
 *
 * Stored as the COLLAPSED set rather than the open one on purpose. A group added
 * to the dashboard later is absent from every stored preference, and absent must
 * mean "open": a new group appearing collapsed would be a metric that silently
 * vanished for every existing user.
 */
const STORAGE_KEY = "tj:dashboard_prefs";

export type DashboardPrefs = {
  /** Ids of the stat groups currently collapsed. */
  collapsedGroups?: string[];
  /**
   * Ids of the whole sections switched off in the widget picker.
   *
   * Hidden and not visible, for the same reason `collapsedGroups` stores the
   * collapsed set: a widget added in a later release is absent from every
   * stored preference, and absent has to mean "shown". Storing the visible set
   * instead would make each new section invisible to exactly the users who had
   * bothered to configure their dashboard.
   */
  hiddenWidgets?: string[];
};

/** Only arrays of strings survive; anything else is dropped field by field. */
function readArray(v: unknown): string[] | undefined {
  return Array.isArray(v) && v.every((x) => typeof x === "string")
    ? (v as string[])
    : undefined;
}

export function getDashboardPrefs(): DashboardPrefs {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed !== "object" || parsed == null) return {};

    // VALIDATED FIELD BY FIELD, not as a whole object. This used to answer `{}`
    // whenever `collapsedGroups` was not an array — which, the moment a second
    // field existed, meant a preference file holding only `hiddenWidgets` was
    // thrown away in full every time it was read. One malformed field must cost
    // that field and nothing else.
    //
    // A hand-edited or half-written value must also never reach `.includes()`
    // as a non-array: the panel would throw on render, for a preference.
    const out: DashboardPrefs = {};
    const collapsed = readArray(parsed.collapsedGroups);
    if (collapsed) out.collapsedGroups = collapsed;
    const hidden = readArray(parsed.hiddenWidgets);
    if (hidden) out.hiddenWidgets = hidden;
    return out;
  } catch {
    return {};
  }
}

export function setDashboardPrefs(prefs: DashboardPrefs) {
  if (typeof window === "undefined") return;
  try {
    const current = getDashboardPrefs();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...prefs }));
  } catch {
    // ignore quota / private mode
  }
}

/** The stored set with `id` toggled, ready to hand back to `setDashboardPrefs`. */
export function toggleCollapsed(
  collapsed: readonly string[],
  id: string,
): string[] {
  return collapsed.includes(id)
    ? collapsed.filter((x) => x !== id)
    : [...collapsed, id];
}
