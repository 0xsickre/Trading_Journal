import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const src = fileURLToPath(new URL("./src", import.meta.url));

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

const alias = {
  "@": src,
  /**
   * `server-only` is not installed — Next aliases it at build time. See
   * `test/server-only-stub.ts` for why that breaks component tests.
   */
  "server-only": fileURLToPath(new URL("./test/server-only-stub.ts", import.meta.url)),
};

export default defineConfig({
  test: {
    /**
     * Two projects, two environments, on purpose.
     *
     * The 958 library tests run in `node` and finish in about twelve seconds.
     * jsdom builds a document per test file, and putting the whole suite behind
     * it would tax every pure-arithmetic test for a DOM none of them touch.
     * Splitting keeps the fast suite fast and lets the slow one be slow.
     *
     * `include`/`exclude` are complementary rather than overlapping: a file is
     * a component test if it ends in `.tsx`, and a library test otherwise. One
     * rule, no file in both projects.
     */
    projects: [
      {
        resolve: { alias },
        test: {
          name: "lib",
          environment: "node",
          include: ["src/**/*.{test,spec}.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "components",
          environment: "jsdom",
          include: ["src/**/*.{test,spec}.tsx"],
          setupFiles: ["./vitest.setup.ts"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      /**
       * The render layer is held OUT of this number, deliberately.
       *
       * v8 counts every file a test imports, so the moment a component test
       * mounts a tree it drags 16 250 previously unmeasured lines into the
       * denominator — and the floors would have to come down to accommodate
       * them. A floor that gets lowered to make room for new code is not a
       * floor.
       *
       * `exclude` rather than `include: ["src/lib/**"]`, and the difference is
       * not cosmetic: setting `include` switches v8 from "files a test imported"
       * to "every file that matches", which pulls in the `server-only` query
       * modules no unit test can reach and scores them 0. That measured a
       * different thing under the same name and dropped the figure from 95.5 to
       * 86 — a number that looks like a regression and is not one. This keeps
       * the metric it always was.
       *
       * The component layer gets its own measured floors once there is enough
       * of it to measure. Until then "not counted here" is said out loud rather
       * than hidden behind a percentage that quietly changed meaning.
       */
      exclude: ["src/components/**", "src/app/**", "src/lib/supabase/types.ts"],
      /**
       * These numbers are a FLOOR, not a target.
       *
       * They sit at what the suite achieves today, so the only thing they can do
       * is fail when a change lowers coverage — which is the entire point.
       * Raising them is a deliberate act; drifting down is not.
       *
       * Two things they deliberately do NOT claim:
       *
       *   1. **They describe the library, and say so above.** Components and
       *      routes have no number at all, and "no number" is not "0%", it is
       *      "not measured". Reading 95% as "the app is 95% tested" is the
       *      mistake this comment exists to prevent.
       *
       *   2. **100% would not mean correct.** Coverage counts EXECUTION, not
       *      assertion: a line run by a test with no `expect` counts as covered.
       *      All three round-3 score defects lived in files at 100% statements
       *      and functions.
       *
       * Branch sits lower than statements on purpose. What is left is mostly
       * defensive `?? 0` arms and guards that cannot fire — e.g.
       * `risk-ratios.ts`'s `spanDays > 0 ? … : null`, where `spanDays` is
       * `daysBetween + 1` after a guard that already rejects a backwards window,
       * so the null arm is unreachable by construction. Chasing those means
       * contorting the code to satisfy a counter.
       */
      thresholds: {
        statements: 95,
        branches: 89,
        functions: 96,
        lines: 96,
        ...Object.fromEntries(
          MONEY_MODULES.map((f) => [f, { statements: 100, functions: 100 }]),
        ),
      },
    },
  },
  resolve: { alias },
});
