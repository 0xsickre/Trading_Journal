/**
 * The account kind Reports last showed — Live, Backtest or All.
 *
 * Remembered so the page opens where the reader left it; a link that names a
 * kind still wins, and with nothing stored the report picks one from the data
 * (`defaultKind`). Same three defences as `sidebar-prefs.ts`: the SSR guard, the
 * parse guard, and the swallowed write.
 */
import { asReportKind, type ReportKind } from "./reports/scope";

const STORAGE_KEY = "tj:reports_kind";

export function getStoredReportKind(): ReportKind | null {
  if (typeof window === "undefined") return null;
  try {
    return asReportKind(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export function setStoredReportKind(kind: ReportKind) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, kind);
  } catch {
    // ignore quota / private mode
  }
}
