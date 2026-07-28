import { describe, expect, it } from "vitest";
import {
  canRender,
  formatDuration,
  formatMetric,
  metric,
  pipSize,
  secondsToDays,
} from "./units";

const forex = {
  symbol: "EURUSD",
  asset_class: "forex",
  point_value: 100_000,
  tick_size: 0.00001,
};
const future = {
  symbol: "MGC",
  asset_class: "future",
  point_value: 10,
  tick_size: 0.1,
};

describe("formatMetric — money", () => {
  it("renders dollars by default", () => {
    expect(formatMetric(metric(1234.5, "money", { currency: "USD" }))).toBe(
      "$1,234.50",
    );
  });

  it("converts to a share of equity in percentage mode", () => {
    const v = metric(500, "money", { currency: "USD", equityBase: 10_000 });
    expect(formatMetric(v, "percentage")).toBe("5.00%");
  });

  it("converts to R when planned risk is known", () => {
    const v = metric(300, "money", { riskMoney: 150 });
    expect(formatMetric(v, "r")).toBe("+2.00R");
  });

  it("converts to points and ticks for a single instrument", () => {
    const v = metric(250, "money", { instrument: future });
    expect(formatMetric(v, "points")).toBe("25 pts");
    expect(formatMetric(v, "ticks")).toBe("250 ticks");
  });

  it("converts to pips for forex", () => {
    // 100 money / 100000 point value = 0.001 points; one pip = 0.0001.
    const v = metric(100, "money", { instrument: forex });
    expect(formatMetric(v, "pips")).toBe("10 pips");
  });

  it("masks money in privacy mode", () => {
    expect(formatMetric(metric(1234.5, "money"), "privacy")).toBe("•••");
  });
});

describe("formatMetric — impossible conversions fall back, never invent", () => {
  it("falls back to dollars when no equity base is known", () => {
    const v = metric(500, "money", { currency: "USD" });
    expect(formatMetric(v, "percentage")).toBe("$500.00");
  });

  it("falls back to dollars when planned risk is unknown", () => {
    expect(formatMetric(metric(500, "money", { currency: "USD" }), "r")).toBe(
      "$500.00",
    );
  });

  it("falls back to dollars when the value spans several instruments", () => {
    // No instrument context = a portfolio aggregate. It has no pip value.
    const v = metric(500, "money", { currency: "USD" });
    expect(formatMetric(v, "pips")).toBe("$500.00");
    expect(formatMetric(v, "ticks")).toBe("$500.00");
  });

  it("refuses pips for a non-forex instrument", () => {
    const v = metric(250, "money", { currency: "USD", instrument: future });
    expect(formatMetric(v, "pips")).toBe("$250.00");
  });
});

describe("formatMetric — unit-less quantities ignore the mode", () => {
  it("shows counts identically in every mode, including privacy", () => {
    const v = metric(42, "count");
    for (const mode of ["dollars", "percentage", "r", "pips", "privacy"] as const) {
      expect(formatMetric(v, mode)).toBe("42");
    }
  });

  it("keeps percentages and R as themselves", () => {
    expect(formatMetric(metric(61.5, "pct"), "dollars")).toBe("61.5%");
    expect(formatMetric(metric(1.25, "r"), "dollars")).toBe("+1.25R");
  });

  it("masks P&L-bearing units under privacy but not counts", () => {
    expect(formatMetric(metric(61.5, "pct"), "privacy")).toBe("•••");
    expect(formatMetric(metric(3, "count"), "privacy")).toBe("3");
  });
});

describe("canRender", () => {
  it("reports percentage unavailable without an equity base", () => {
    expect(canRender(metric(1, "money"), "percentage")).toBe(false);
    expect(canRender(metric(1, "money", { equityBase: 100 }), "percentage")).toBe(
      true,
    );
  });

  it("reports pips unavailable for futures and available for forex", () => {
    expect(canRender(metric(1, "money", { instrument: future }), "pips")).toBe(false);
    expect(canRender(metric(1, "money", { instrument: forex }), "pips")).toBe(true);
  });

  it("always allows dollars and privacy", () => {
    expect(canRender(metric(1, "money"), "dollars")).toBe(true);
    expect(canRender(metric(1, "money"), "privacy")).toBe(true);
  });
});

describe("pipSize", () => {
  it("is ten ticks for forex and null elsewhere", () => {
    expect(pipSize(forex)).toBeCloseTo(0.0001, 10);
    expect(pipSize(future)).toBeNull();
    expect(pipSize(null)).toBeNull();
  });
});

describe("formatDuration", () => {
  it("scales from seconds to days", () => {
    expect(formatDuration(30)).toBe("30s");
    expect(formatDuration(45 * 60)).toBe("45m");
    expect(formatDuration(5 * 3600 + 20 * 60)).toBe("5h 20m");
    expect(formatDuration(3 * 86400 + 4 * 3600)).toBe("3d 4h");
    expect(formatDuration(3 * 86400)).toBe("3d");
  });

  it("returns an em dash for missing or negative input", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(-5)).toBe("—");
  });
});

describe("secondsToDays", () => {
  it("converts and rejects nonsense", () => {
    expect(secondsToDays(86_400)).toBe(1);
    expect(secondsToDays(43_200)).toBe(0.5);
    expect(secondsToDays(null)).toBeNull();
    expect(secondsToDays(-1)).toBeNull();
  });
});
