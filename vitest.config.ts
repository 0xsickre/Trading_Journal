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
  // Does not compute money — GUARDS it. The only check standing between a
  // missed sign and a `gross_pl` that looks perfectly healthy (measured: entry
  // −5000, exit −4990 on ES gives +$500 and R = 1.00, with no flag anywhere). A
  // boundary that lets one case through is no boundary, so it sits under the
  // same floor as the arithmetic.
  "src/lib/journal/trade-input-schema.ts",
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
     * The 1101 library tests run in `node` and finish in about twelve seconds.
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
          /**
           * Longer than the 5 s default, to stay clear of the async-util budget
           * raised in `vitest.setup.ts`.
           *
           * A test that awaits three `findBy*` calls has to be allowed to spend
           * three of those budgets before Vitest steps in — otherwise the
           * timeout that fires is this one, whose message is "test timed out"
           * rather than Testing Library's, which prints the query and the DOM
           * it searched. The number is a ceiling on how long a FAILING test
           * takes to report; a passing one never approaches it.
           */
          testTimeout: 20_000,
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      /**
       * `src/app` (15 pages across 33 files) stays out. They are server
       * components whose logic
       * is `await getCurrentUser()` then `redirect()` then pass props along —
       * the props are what carry a number, and those are asserted on the other
       * side, at the component that renders them. Testing a route means a Next
       * runtime this repo's tests do not have; see `ROADMAP.md`'s Faza 10 for
       * why that stays a deliberate non-goal, not an oversight.
       *
       * `exclude` rather than `include: ["src/lib/**", "src/components/**"]`,
       * and the difference is not cosmetic: setting `include` switches v8 from
       * "files a test imported" to "every file that matches", which pulls in
       * the `server-only` query modules no unit test can reach and scores them
       * 0. That measured a different thing under the same name and dropped the
       * figure from 95.5 to 86 in an earlier round — a number that looks like a
       * regression and is not one. This keeps the metric it always was.
       */
      exclude: ["src/app/**", "src/lib/supabase/types.ts"],
      /**
       * Two floors, not one — `src/lib/**` and `src/components/**` are checked
       * independently below, deliberately never blended into one aggregate.
       *
       * They measure different things by design: `src/lib` is pure functions,
       * mostly arithmetic, and Phase 0–9 held it near 96%. `src/components` is
       * Phase 10's render layer — 87 files, 46 with dedicated render tests
       * and the rest reached only incidentally, through whatever a
       * tested component happens to import (many `src/components/ui` primitives
       * export sub-parts — `DropdownMenuRadioItem`, `PopoverTitle` — that
       * nothing in this app renders at all). A single blended number would
       * either drag the library floor down to component-layer reality or lie
       * about how tested the render layer actually is; two floors say both
       * things honestly instead of averaging them into a number that describes
       * neither.
       *
       * Both are FLOORS, not targets — they sit at what the suite achieves
       * today, so the only thing they can do is fail when a change lowers
       * coverage. Two things they deliberately do NOT claim:
       *
       *   1. **`src/components`'s floor is not "well tested".** 64/64/61/65 is
       *      the honest state of a layer that started this phase at zero and
       *      is not finished — Faza 10 covers the highest-risk components
       *      (Tier 1 and 2 in `ROADMAP.md`), not all 87. Reading this floor as
       *      "the UI is 64% correct" repeats the exact mistake the `src/lib`
       *      floor's comment already warns against, one layer up.
       *
       *   2. **100% would not mean correct, on either floor.** Coverage counts
       *      EXECUTION, not assertion: a line run by a test with no `expect`
       *      counts as covered. All three round-3 score defects lived in files
       *      at 100% statements and functions, and `W1`–`W4` (Faza 10) were
       *      each found by a render test asserting something already-covered
       *      code got WRONG, not by a line going uncovered.
       *
       * Branch sits lower than statements on both floors, for the same reason:
       * on `src/lib`, mostly defensive `?? 0` arms and guards that cannot fire
       * by construction (see `risk-ratios.ts`'s `spanDays > 0 ? … : null`,
       * unreachable once an earlier guard rejects a backwards window). On
       * `src/components`, the same shape plus every conditional branch of a
       * component reached only transitively — a prop value another test never
       * happened to pass.
       */
      thresholds: {
        "src/lib/**": {
          statements: 95,
          branches: 89,
          functions: 96,
          lines: 96,
        },
        "src/components/**": {
          statements: 64,
          branches: 64,
          functions: 61,
          lines: 65,
        },
        ...Object.fromEntries(
          MONEY_MODULES.map((f) => [f, { statements: 100, functions: 100 }]),
        ),
      },
    },
  },
  resolve: { alias },
});
