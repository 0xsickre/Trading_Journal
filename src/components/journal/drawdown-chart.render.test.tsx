import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DrawdownChart } from "./drawdown-chart";
import { buildBalanceTimeline, computeDrawdown, drawdownSeries } from "@/lib/journal/balance";

/** The value under a `Figure` label — "Max" and "Average" can coincidentally
 *  show the same formatted money, so a bare `getByText` is ambiguous. */
function figureValue(label: string): string {
  return screen.getByText(label).nextElementSibling?.textContent ?? "";
}

vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 400, height: 300 }}>{children}</div>
    ),
  };
});

/**
 * A finding from the phase plan's own reconnaissance, never picked up by any
 * earlier step: `balance.ts` computes BOTH `maxPctOfEquity` and
 * `currentPctOfEquity` as `Math.abs(...)` — positive magnitudes — but the
 * component only negated one of the two before display. "Max 9.09%" sat
 * right next to "Current −7.27%" and read like a gain. `FIXED` alongside
 * this test, per the plan's own note ("fixed together with its own test, in
 * the step that covers this component").
 */
describe("DrawdownChart — both percent figures read negative, like the money basis does", () => {
  // 10 000 start, peak after +1000 (day1) never exceeded again: 0 (day2),
  // 300 (day3), 200 (day4). Drawdown money: −1000 (day2, the deepest — MAX),
  // −700 (day3), −800 (day4, the LAST point — CURRENT). Max ≠ current, both
  // nonzero, so the two figures can't accidentally agree by construction.
  const timeline = buildBalanceTimeline(10_000, [
    { at: "2026-01-01T00:00:00Z", pnl: 1000 },
    { at: "2026-01-02T00:00:00Z", pnl: -1000 },
    { at: "2026-01-03T00:00:00Z", pnl: 300 },
    { at: "2026-01-04T00:00:00Z", pnl: -100 },
  ]);
  const stats = computeDrawdown(timeline);
  const series = drawdownSeries(timeline);

  it("money basis: both Max and Current are negative, matching each other's sign", () => {
    render(<DrawdownChart series={series} stats={stats} currency="USD" />);
    expect(figureValue("Max")).toBe("-$1,000.00");
    expect(figureValue("Current")).toBe("-$800.00");
  });

  it("percent basis: Max is negative too, not the un-negated positive magnitude balance.ts stores", async () => {
    const user = userEvent.setup({ delay: null });
    render(<DrawdownChart series={series} stats={stats} currency="USD" />);
    await user.click(screen.getByRole("button", { name: "%" }));

    // 1000 / 11000 × 100 = 9.0909…%; 800 / 11000 × 100 = 7.2727…%.
    expect(figureValue("Max")).toBe("-9.09%");
    expect(figureValue("Current")).toBe("-7.27%");
    // The pre-fix bug, explicitly absent: Max must not read as a positive
    // percentage next to a negative Current.
    expect(screen.queryByText("9.09%")).not.toBeInTheDocument();
  });
});
