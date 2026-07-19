export const TRADE_IMAGE_KINDS = ["htf_pre", "ltf_pre", "ltf_post"] as const;

export type TradeImageKind = (typeof TRADE_IMAGE_KINDS)[number];

export const TRADE_IMAGE_KIND_LABELS: Record<TradeImageKind, string> = {
  htf_pre: "HTF Pre",
  ltf_pre: "LTF Pre",
  ltf_post: "LTF Post",
};

export const TRADE_IMAGE_KIND_HINTS: Record<TradeImageKind, string> = {
  htf_pre: "Higher timeframe before entry",
  ltf_pre: "Lower timeframe before entry",
  ltf_post: "Lower timeframe after exit",
};

const SNAPSHOT_ID_RE = /tradingview\.com\/x\/([A-Za-z0-9]+)/i;
const CHART_LAYOUT_RE = /tradingview\.com\/chart\//i;

export function parseTradingViewSnapshotId(url: string): string | null {
  const m = url.trim().match(SNAPSHOT_ID_RE);
  return m?.[1] ?? null;
}

export function isTradingViewChartLayoutUrl(url: string): boolean {
  return CHART_LAYOUT_RE.test(url.trim());
}

export function normalizeTradingViewSnapshotUrl(url: string): string | null {
  const id = parseTradingViewSnapshotId(url);
  if (!id) return null;
  return `https://www.tradingview.com/x/${id}/`;
}

export function tradingViewSnapshotPngUrl(urlOrId: string): string | null {
  const id = parseTradingViewSnapshotId(urlOrId)
    ?? (/^[A-Za-z0-9]+$/.test(urlOrId.trim()) ? urlOrId.trim() : null);
  if (!id) return null;
  return `https://s3.tradingview.com/snapshots/${id[0]}/${id}.png`;
}

export type ValidateSnapshotResult =
  | { ok: true; url: string }
  | { ok: false; message: string };

export function validateTradingViewSnapshotUrl(
  input: string,
): ValidateSnapshotResult {
  const raw = input.trim();
  if (!raw) return { ok: false, message: "URL is required" };
  if (isTradingViewChartLayoutUrl(raw)) {
    return {
      ok: false,
      message:
        "Use Copy link to chart image (camera → first option), not the interactive chart link.",
    };
  }
  const normalized = normalizeTradingViewSnapshotUrl(raw);
  if (!normalized) {
    return {
      ok: false,
      message: "Paste a TradingView snapshot link (tradingview.com/x/…)",
    };
  }
  return { ok: true, url: normalized };
}

/** Primary link for journal grid: ltf_pre, else first available slot. */
export function primaryTradeImageUrl(
  images: Partial<Record<TradeImageKind, string>>,
): string | null {
  if (images.ltf_pre) return images.ltf_pre;
  for (const kind of TRADE_IMAGE_KINDS) {
    const url = images[kind];
    if (url) return url;
  }
  return null;
}
