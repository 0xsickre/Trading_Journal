import { describe, expect, it } from "vitest";
import {
  DEFAULT_BASELINE_TRADES,
  EXPERIMENT_METRIC_KEYS,
  MIN_WINDOW_TRADES,
  experimentWindows,
  measureExperiment,
  type Experiment,
} from "./experiments";
import { getMetric } from "./reports/metrics";
import { enrich, metricCtx } from "./reports/test-helpers";

/**
 * The experiment card exists to refuse a verdict, so most of this file is
 * about the refusals: too few trades, an interval that still holds zero, and a
 * window that reaches back before the book began.
 */

const START = "2026-03-02"; // a Monday
const NOW = "2026-03-30";

const exp = (over: Partial<Experiment> = {}): Experiment => ({
  id: "e1",
  started_week: START,
  hypothesis: "Stop trading the first hour",
  metric_key: "win_rate",
  baseline_trades: DEFAULT_BASELINE_TRADES,
  ended_week: null,
  status: "running",
  ...over,
});

/** Trades closed in a given week, `wins` of them winners. */
const week = (closeWeek: string, wins: number, total: number) =>
  Array.from({ length: total }, (_, i) => ({
    id: `${closeWeek}-${i}`,
    // Tuesday of that week, so the close day sits inside it.
    closedAt: `${closeWeek}T12:00:00Z`,
    net: i < wins ? 100 : -100,
    r: i < wins ? 1 : -1,
  }));

const book = (...specs: ReturnType<typeof week>[]) => enrich(specs.flat());

describe("EXPERIMENT_METRIC_KEYS", () => {
  it("offers only metrics that can state how sure they are", () => {
    for (const key of EXPERIMENT_METRIC_KEYS) {
      const m = getMetric(key)!;
      expect(m.interval).toBeTypeOf("function");
      expect(m.difference).toBeTypeOf("function");
    }
  });
});

describe("experimentWindows — the baseline is trades, not weeks (F5.4)", () => {
  it("runs forward to the week running now, and has no baseline dates without trades", () => {
    const w = experimentWindows(exp(), [], NOW);
    expect(w.beforeFrom).toBeNull();
    expect(w.beforeTo).toBeNull();
    expect(w.afterFrom).toBe(START);
    expect(w.afterTo).toBe(NOW);
  });

  it("stops where a finished experiment stopped", () => {
    const w = experimentWindows(exp({ ended_week: "2026-03-16" }), [], NOW);
    expect(w.afterTo).toBe("2026-03-16");
  });

  it("takes the LAST baseline_trades trades closed before the start, however far back", () => {
    const w = experimentWindows(
      exp({ baseline_trades: 10 }),
      // Four long before the start, eight just before it: the newest ten count.
      book(week("2025-12-01", 1, 4), week("2026-02-23", 1, 8), week("2026-03-09", 1, 3)),
      NOW,
    );
    expect(w.before).toHaveLength(10);
    expect(w.before.filter((t) => t.closeWeek === "2025-12-01")).toHaveLength(2);
    expect(w.beforeFrom).toBe("2025-12-01");
    expect(w.beforeTo).toBe("2026-02-23");
    expect(w.after).toHaveLength(3);
  });

  it("keeps a trade after a finished experiment out of both windows", () => {
    const ended = experimentWindows(exp({ ended_week: "2026-03-09" }), book(week("2026-03-23", 1, 2)), NOW);
    expect(ended.after).toHaveLength(0);
    expect(ended.before).toHaveLength(0);
  });
});

describe("measureExperiment", () => {
  const winRate = getMetric("win_rate")!;

  it("says 'too thin' rather than comparing two handfuls", () => {
    const m = measureExperiment(
      exp(),
      winRate,
      book(week("2026-02-09", 2, 4), week("2026-03-09", 3, 4)),
      metricCtx,
      NOW,
    );
    expect(m.verdict).toBe("thin");
    // The numbers are still shown — refusing a verdict is not refusing the data.
    expect(m.before).toBeCloseTo(50);
    expect(m.after).toBeCloseTo(75);
    // …but no interval is offered for a gap this size of sample.
    expect(m.interval).toBeNull();
    expect(m.beforeN).toBeLessThan(MIN_WINDOW_TRADES);
  });

  it("withholds the verdict while the interval still holds zero", () => {
    const m = measureExperiment(
      exp(),
      winRate,
      book(week("2026-02-09", 3, 6), week("2026-03-09", 4, 6)),
      metricCtx,
      NOW,
    );
    // Six trades against six, 50 % against 67 %. On the point estimate that is
    // a 17-point improvement, and it is nothing.
    expect(m.delta).toBeCloseTo(16.67, 1);
    expect(m.verdict).toBe("unknown");
  });

  it("calls it better only once the gap has cleared zero", () => {
    const m = measureExperiment(
      exp({ baseline_trades: 40 }),
      winRate,
      book(
        week("2026-02-02", 4, 30),
        week("2026-02-09", 4, 30),
        week("2026-03-02", 26, 30),
        week("2026-03-09", 26, 30),
      ),
      metricCtx,
      NOW,
    );
    expect(m.verdict).toBe("better");
    expect(m.interval!.lo).toBeGreaterThan(0);
  });

  it("calls a decline what it is", () => {
    const m = measureExperiment(
      exp(),
      winRate,
      book(
        week("2026-02-02", 26, 30),
        week("2026-02-09", 26, 30),
        week("2026-03-02", 4, 30),
        week("2026-03-09", 4, 30),
      ),
      metricCtx,
      NOW,
    );
    expect(m.verdict).toBe("worse");
  });

  it("has no numbers at all for a book that was empty before the change", () => {
    const m = measureExperiment(exp(), winRate, book(week("2026-03-09", 4, 6)), metricCtx, NOW);
    expect(m.before).toBeNull();
    expect(m.delta).toBeNull();
    expect(m.verdict).toBe("thin");
  });

  it("states no gap between two flawless windows", () => {
    // Profit factor is Infinity on both sides. Infinity − Infinity is not zero.
    const m = measureExperiment(
      exp({ metric_key: "profit_factor" }),
      getMetric("profit_factor")!,
      book(week("2026-02-09", 6, 6), week("2026-03-09", 6, 6)),
      metricCtx,
      NOW,
    );
    expect(m.before).toBe(Infinity);
    expect(m.delta).toBeNull();
    expect(m.verdict).toBe("unknown");
  });
});
