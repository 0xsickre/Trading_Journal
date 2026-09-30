import { describe, expect, it } from "vitest";
import {
  isStoredImage,
  normalizeTradingViewSnapshotUrl,
  parseTradingViewSnapshotId,
  MAX_TRADE_IMAGES,
  storedImagePath,
  tradingViewSnapshotPngUrl,
  validateTradeImageList,
  validateTradeImageRef,
  validateTradingViewSnapshotUrl,
} from "./tradingview-snapshot";

describe("parseTradingViewSnapshotId", () => {
  it("extracts id from /x/ URL", () => {
    expect(
      parseTradingViewSnapshotId("https://www.tradingview.com/x/AbCdEfGh/"),
    ).toBe("AbCdEfGh");
    expect(parseTradingViewSnapshotId("http://tradingview.com/x/xy12Z9")).toBe(
      "xy12Z9",
    );
  });

  it("returns null for chart layout", () => {
    expect(
      parseTradingViewSnapshotId(
        "https://www.tradingview.com/chart/EURUSD/abc/",
      ),
    ).toBeNull();
  });
});

describe("normalizeTradingViewSnapshotUrl", () => {
  it("canonicalizes URL", () => {
    expect(
      normalizeTradingViewSnapshotUrl("https://www.tradingview.com/x/AbCdEfGh"),
    ).toBe("https://www.tradingview.com/x/AbCdEfGh/");
  });
});

describe("tradingViewSnapshotPngUrl", () => {
  it("builds S3 PNG path", () => {
    expect(
      tradingViewSnapshotPngUrl("https://www.tradingview.com/x/AbCdEfGh/"),
    ).toBe("https://s3.tradingview.com/snapshots/A/AbCdEfGh.png");
  });
});

describe("validateTradingViewSnapshotUrl", () => {
  it("accepts snapshot links", () => {
    const r = validateTradingViewSnapshotUrl(
      "https://www.tradingview.com/x/AbCdEfGh/",
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.url).toBe("https://www.tradingview.com/x/AbCdEfGh/");
  });

  it("rejects chart layout links", () => {
    const r = validateTradingViewSnapshotUrl(
      "https://www.tradingview.com/chart/BTCUSD/",
    );
    expect(r.ok).toBe(false);
  });

  it("rejects empty", () => {
    expect(validateTradingViewSnapshotUrl("").ok).toBe(false);
  });
});

describe("validateTradeImageList", () => {
  it("keeps the filled ones in order and drops blanks", () => {
    expect(
      validateTradeImageList(["https://www.tradingview.com/x/Aaaaaaaa", " ", "storage:97edd6db-12db-4156-9f89-77d2dcaa66d7/a.png"]),
    ).toEqual({
      ok: true,
      urls: ["https://www.tradingview.com/x/Aaaaaaaa/", "storage:97edd6db-12db-4156-9f89-77d2dcaa66d7/a.png"],
    });
  });

  it("names the first bad one and refuses more than the cap", () => {
    expect(validateTradeImageList(["https://www.tradingview.com/chart/X/"]).ok).toBe(false);
    const many = Array.from({ length: MAX_TRADE_IMAGES + 1 }, () => "https://www.tradingview.com/x/Aaaaaaaa/");
    expect(validateTradeImageList(many)).toEqual({ ok: false, error: `At most ${MAX_TRADE_IMAGES} charts on one trade.` });
  });
});

describe("an uploaded chart image (K6)", () => {
  const uid = "0b7e4c1a-3f2d-4e5a-9b8c-1d2e3f4a5b6c";

  it("is told apart from a link, and resolves to its path in the bucket", () => {
    const ref = `storage:${uid}/chart.png`;
    expect(isStoredImage(ref)).toBe(true);
    expect(isStoredImage("https://www.tradingview.com/x/AbC123/")).toBe(false);
    expect(storedImagePath(ref)).toBe(`${uid}/chart.png`);
  });

  it("is accepted as it is stored, and a malformed one is refused", () => {
    expect(validateTradeImageRef(`storage:${uid}/chart.png`)).toEqual({ ok: true, url: `storage:${uid}/chart.png` });
    expect(validateTradeImageRef("storage:../../etc/passwd").ok).toBe(false);
    expect(storedImagePath("storage:../../etc/passwd")).toBeNull();
  });

  it("leaves a TradingView link to the link's own rules", () => {
    expect(validateTradeImageRef("https://www.tradingview.com/x/AbC123")).toEqual({
      ok: true,
      url: "https://www.tradingview.com/x/AbC123/",
    });
  });
});
