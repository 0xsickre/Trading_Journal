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

    // VALIDATED FIELD BY FIELD, not as a whole object — so a malformed field
    // costs that field and nothing else. With one field the difference is
    // invisible; the moment a second one exists, whole-object rejection means a
    // preference holding only the good field is thrown away every time it is
    // read. It briefly did hold two, and that is exactly what happened.
    //
    // `readArray` also checks the ELEMENTS, which the original did not: a
    // hand-edited value must never reach `.includes()` as a non-array, and an
    // array of numbers must not silently match nothing.
    const out: DashboardPrefs = {};
    const collapsed = readArray(parsed.collapsedGroups);
    if (collapsed) out.collapsedGroups = collapsed;
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
