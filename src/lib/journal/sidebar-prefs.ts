/**
 * Whether the desktop sidebar is pinned open.
 *
 * Unpinned — the default — it hides off the left edge and slides in when the
 * pointer reaches that edge, so the page gets the full width until the menu is
 * wanted. Pinned, it stays in the layout as it always did.
 *
 * Same three defences as `dashboard-prefs.ts`: the SSR guard, the parse guard,
 * and the swallowed write. A display preference of this browser, not of the
 * account, and never able to break the page.
 */
const STORAGE_KEY = "tj:sidebar_pinned";

export function getSidebarPinned(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSidebarPinned(pinned: boolean) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, pinned ? "1" : "0");
  } catch {
    // ignore quota / private mode
  }
}
