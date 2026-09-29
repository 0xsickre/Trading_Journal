const STORAGE_KEY = "tj:trade_form_prefs";

export type TradeFormPrefs = {
  accountId?: string;
  /** Last symbol logged after the fact — a day trader logs the same contract all day. */
  instrument?: string;
};

export function getTradeFormPrefs(): TradeFormPrefs {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as TradeFormPrefs;
    return typeof parsed === "object" && parsed != null ? parsed : {};
  } catch {
    return {};
  }
}

export function setTradeFormPrefs(prefs: TradeFormPrefs) {
  if (typeof window === "undefined") return;
  try {
    const current = getTradeFormPrefs();
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...current, ...prefs }),
    );
  } catch {
    // ignore quota / private mode
  }
}
