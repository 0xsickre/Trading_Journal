/**
 * A trade's charts are a LIST (30.09.2026): as many as the trader adds, in the
 * order added (`sort_order`). They used to be three fixed slots — HTF before,
 * LTF before, LTF after — one picture each; rows written then keep their
 * `kind`, every new one is `chart`.
 */
export const TRADE_IMAGE_KIND = "chart";

/** Enough for any trade, and a bound on what one request may write. */
export const MAX_TRADE_IMAGES = 20;

const SNAPSHOT_ID_RE = /tradingview\.com\/x\/([A-Za-z0-9]+)/i;
const CHART_LAYOUT_RE = /tradingview\.com\/chart\//i;

export function parseTradingViewSnapshotId(url: string): string | null {
  const m = url.trim().match(SNAPSHOT_ID_RE);
  return m?.[1] ?? null;
}

function isTradingViewChartLayoutUrl(url: string): boolean {
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

/**
 * An uploaded chart image, as the row stores it: `storage:<user id>/<file>` in
 * the private `trade-images` bucket (K6, 29.09.2026: "da se mogu čuvati slike
 * za chartove, a ne linkovi"). The same column as a TradingView link, so every
 * reader keeps one field; the prefix tells the two apart, and the database CHECK
 * holds the path to the row's own user.
 */
export const STORED_IMAGE_PREFIX = "storage:";

const STORED_IMAGE_RE = /^storage:[0-9a-f-]{36}\/[A-Za-z0-9._-]+$/;

export function isStoredImage(ref: string | null | undefined): boolean {
  return typeof ref === "string" && ref.startsWith(STORED_IMAGE_PREFIX);
}

/** The object path inside the bucket, or null for anything that is not a stored image. */
export function storedImagePath(ref: string): string | null {
  return STORED_IMAGE_RE.test(ref) ? ref.slice(STORED_IMAGE_PREFIX.length) : null;
}

/** A chart as the row will store it: an uploaded image, or a TradingView snapshot link. */
export function validateTradeImageRef(input: string): ValidateSnapshotResult {
  const raw = input.trim();
  if (isStoredImage(raw)) {
    return storedImagePath(raw)
      ? { ok: true, url: raw }
      : { ok: false, message: "That uploaded image reference is not valid — upload it again." };
  }
  return validateTradingViewSnapshotUrl(raw);
}

/**
 * Validate a list of chart references for writing: blanks dropped, each one
 * checked, at most `MAX_TRADE_IMAGES`. The first bad one names the problem.
 */
export function validateTradeImageList(
  refs: readonly string[] | undefined,
): { ok: true; urls: string[] } | { ok: false; error: string } {
  const filled = (refs ?? []).map((r) => r.trim()).filter(Boolean);
  if (filled.length > MAX_TRADE_IMAGES) {
    return { ok: false, error: `At most ${MAX_TRADE_IMAGES} charts on one trade.` };
  }
  const urls: string[] = [];
  for (const ref of filled) {
    const v = validateTradeImageRef(ref);
    if (!v.ok) return { ok: false, error: v.message };
    urls.push(v.url);
  }
  return { ok: true, urls };
}
