const STORAGE_KEY = "tj:trade_form_prefs";

export type TradeFormPrefs = {
  accountId?: string;
  riskPct?: string;
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

/** Pick first risk_pct option that looks like 1%. */
export function defaultRiskPctOption(
  options: { value: string; label: string }[],
): string | undefined {
  const match = options.find(
    (o) =>
      o.value === "1%" ||
      o.label === "1%" ||
      /^1\s*%$/.test(o.label.trim()) ||
      /^1\s*%$/.test(o.value.trim()),
  );
  return match?.value ?? options[0]?.value;
}
