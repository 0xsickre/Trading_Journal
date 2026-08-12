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
};

export function getDashboardPrefs(): DashboardPrefs {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as DashboardPrefs;
    if (typeof parsed !== "object" || parsed == null) return {};
    // A hand-edited or half-written value must not reach `.includes()` as a
    // non-array — the panel would throw on render for a preference.
    return Array.isArray(parsed.collapsedGroups) ? parsed : {};
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
