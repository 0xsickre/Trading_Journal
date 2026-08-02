import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Modules where a wrong number is a wrong number ON SCREEN, presented as fact.
 *
 * These carry a 100% STATEMENT and FUNCTION floor. Not branch — see the note on
 * the global thresholds below for why branch 100% is the wrong target.
 */
const MONEY_MODULES = [
  "src/lib/journal/analytics.ts",
  "src/lib/journal/balance.ts",
  "src/lib/journal/breakeven.ts",
  "src/lib/journal/costs.ts",
  "src/lib/journal/entry-slippage.ts",
  "src/lib/journal/excursion.ts",
  "src/lib/journal/excursion-scan.ts",
  "src/lib/journal/exit-efficiency.ts",
  "src/lib/journal/hold-time.ts",
  "src/lib/journal/plan-calculations.ts",
  "src/lib/journal/position-stats.ts",
  "src/lib/journal/risk-metrics.ts",
  "src/lib/journal/risk-ratios.ts",
];

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      /**
       * These numbers are a FLOOR, not a target.
       *
       * They sit at what the suite achieves today, so the only thing they can do
       * is fail when a change lowers coverage — which is the entire point.
       * Raising them is a deliberate act; drifting down is not.
       *
       * Two things they deliberately do NOT claim:
       *
       *   1. **They describe a quarter of the codebase.** Coverage only sees
       *      files a test imports — 46 of 177 source files. Components (~16k
       *      lines), routes and the server-only query layer have no number at
       *      all, and "no number" is not "0%", it is "not measured". Reading 93%
       *      as "the app is 93% tested" is the mistake this comment exists to
       *      prevent.
       *
       *   2. **100% would not mean correct.** Coverage counts EXECUTION, not
       *      assertion: a line run by a test with no `expect` counts as covered.
       *      The critical seed defect found in round 3 lives in SQL, and no
       *      TypeScript percentage would ever have moved for it.
       *
       * Branch sits lower than statements on purpose. What is left is mostly
       * defensive `?? 0` arms and guards that cannot fire — e.g.
       * `risk-ratios.ts`'s `spanDays > 0 ? … : null`, where `spanDays` is
       * `daysBetween + 1` after a guard that already rejects a backwards window,
       * so the null arm is unreachable by construction. Chasing those means
       * contorting the code to satisfy a counter.
       */
      thresholds: {
        statements: 93,
        branches: 88,
        functions: 91,
        lines: 95,
        ...Object.fromEntries(
          MONEY_MODULES.map((f) => [f, { statements: 100, functions: 100 }]),
        ),
      },
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
