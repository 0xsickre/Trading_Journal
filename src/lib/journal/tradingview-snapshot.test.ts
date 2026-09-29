import { describe, expect, it } from "vitest";
import {
  isStoredImage,
  normalizeTradingViewSnapshotUrl,
  parseTradingViewSnapshotId,
  primaryTradeImageUrl,
  storedImagePath,
  tradingViewSnapshotPngUrl,
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

describe("primaryTradeImageUrl", () => {
  it("prefers ltf_pre over htf_pre", () => {
    expect(
      primaryTradeImageUrl({
        htf_pre: "https://www.tradingview.com/x/Aaaaaaaa/",
        ltf_pre: "https://www.tradingview.com/x/Bbbbbbbb/",
      }),
    ).toBe("https://www.tradingview.com/x/Bbbbbbbb/");
  });

  it("falls back to any kind", () => {
    expect(
      primaryTradeImageUrl({
        ltf_post: "https://www.tradingview.com/x/Cccccccc/",
      }),
    ).toBe("https://www.tradingview.com/x/Cccccccc/");
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
