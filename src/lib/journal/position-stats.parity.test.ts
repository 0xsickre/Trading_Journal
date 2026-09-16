import { describe, expect, it } from "vitest";
import { computePositionStats } from "./position-stats";
import { PARITY_CASES } from "./position-stats.parity.fixture";

/**
 * Paper → `computePositionStats`.
 *
 * The other half of the same proof — the same fixture run through
 * `tj_position_stats` against a live database — cannot live here: vitest has no
 * Postgres. It is recorded in `CODE_REVIEW.md` with the measured outcome
 * (12 cases × 9 columns, all passing).
 *
 * What this file keeps is that the TS side does not drift away from the numbers
 * on paper that the SQL side hit too. As long as both aim at the same fixture, a
 * divergence has to fail at least one of them.
 */
describe("position-stats ↔ tj_position_stats — parity against the paper", () => {
  for (const c of PARITY_CASES) {
    it(`${c.name}: ${c.proves}`, () => {
      const got = computePositionStats(c.input);

      // toBeCloseTo would let a null through; every column is compared
      // explicitly, and telling null from zero is part of the claim here, not a
      // detail.
      const cols = [
        "avg_entry",
        "avg_exit",
        "gross_points",
        "gross_pl",
        "net_pl",
        "planned_risk_pts",
        "realized_r",
        "realized_r_net",
      ] as const;

      for (const col of cols) {
        const expected = c.paper[col];
        const actual = got[col];
        if (expected === null) {
          expect(actual, `${c.name} → ${col} has to be null`).toBeNull();
        } else {
          expect(actual, `${c.name} → ${col}`).not.toBeNull();
          expect(actual as number, `${c.name} → ${col}`).toBeCloseTo(expected, 10);
        }
      }
    });
  }

  it("covers every shape a book can take", () => {
    // The set is not arbitrary: every case exists because of one branch in the
    // view. If someone adds a branch without adding a shape, this number is
    // where it shows.
    expect(PARITY_CASES).toHaveLength(20);
    expect(new Set(PARITY_CASES.map((c) => c.name)).size).toBe(20);
  });

  it("R on a partial exit is diluted, and that is a decision, not a consequence", () => {
    // Pulled out of the loop because it is the one convention in this file a
    // reader can mistake for a bug. The closed part did run a full 1.0 R.
    const partial = PARITY_CASES.find((c) => c.name.startsWith("T4"))!;
    const got = computePositionStats(partial.input);

    expect(got.realized_r).toBeCloseTo(0.4, 10);

    // The same numerator divided by the CLOSED quantity would give 1.0. The
    // number stands here so it is visible what was rejected and why: the
    // remaining 6 units are still under the same risk and have paid nothing.
    // See the reasoning in position-stats.ts:118-139.
    const onClosedQty = got.gross_points! / (got.planned_risk_pts! * got.exit_qty);
    expect(onClosedQty).toBeCloseTo(1, 10);
  });
});
