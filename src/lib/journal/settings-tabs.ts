/**
 * Which Settings tab is open, as it is written in the URL.
 *
 * In the query string (`?tab=accounts`, `&sub=tags`) so a reload, a link or
 * the back button lands on the tab the trader was looking at instead of always
 * on Categories. Pure, so the parsing and the URL rewrite are tested without a
 * browser.
 */

export const SETTINGS_TABS = ["categories", "tracker", "instruments", "accounts", "deposits"] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

export const CATEGORY_SUBTABS = ["categories", "tags"] as const;
export type CategorySubtab = (typeof CATEGORY_SUBTABS)[number];

/** The tab named by `?tab=`, or Categories for anything missing or unknown. */
export function parseSettingsTab(raw: string | string[] | undefined): SettingsTab {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (SETTINGS_TABS as readonly string[]).includes(v ?? "") ? (v as SettingsTab) : "categories";
}

/** The Categories sub-tab named by `?sub=`, or Categories. */
export function parseCategorySubtab(raw: string | string[] | undefined): CategorySubtab {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "tags" ? "tags" : "categories";
}

/**
 * The query string after a tab change. The default of each is left out, so the
 * plain `/settings` stays the plain URL; `sub` only means something under
 * Categories and is dropped anywhere else.
 */
export function settingsSearch(
  current: string,
  change: { tab?: SettingsTab; sub?: CategorySubtab },
): string {
  const params = new URLSearchParams(current);
  if (change.tab !== undefined) {
    if (change.tab === "categories") params.delete("tab");
    else params.set("tab", change.tab);
    if (change.tab !== "categories") params.delete("sub");
  }
  if (change.sub !== undefined) {
    if (change.sub === "categories") params.delete("sub");
    else params.set("sub", change.sub);
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

/** Rewrites the address bar in place — no navigation, no server round trip. */
export function replaceSettingsSearch(change: { tab?: SettingsTab; sub?: CategorySubtab }) {
  const next = settingsSearch(window.location.search, change);
  window.history.replaceState(null, "", `${window.location.pathname}${next}${window.location.hash}`);
}
