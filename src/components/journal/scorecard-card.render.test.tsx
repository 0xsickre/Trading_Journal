import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ScorecardCard } from "./scorecard-card";
import { computeScorecard, type ScorecardInputs } from "@/lib/journal/scorecard";

/**
 * The card's job is to keep three answers apart and to refuse a fourth. The
 * arithmetic is proved in `scorecard.test.ts`; what is held here is that a
 * withheld figure reaches the screen as an em dash rather than as a zero, and
 * that Edge arrives with its interval rather than as a grade.
 */

const card = (over: Partial<ScorecardInputs> = {}) =>
  render(
    <ScorecardCard
      card={computeScorecard({
        trackerPct: 80,
        followRatePct: 60,
        maxDrawdownPctOfEquity: 10,
        underWaterDays: 0,
        decidedRs: [1, 1, 1, 1, 1, 1],
        trades: 40,
        ...over,
      })}
    />,
  );

/** The axis figure: the first `tabular-nums` node inside the labelled group. */
const axis = (label: string): string => {
  const group = screen.getByRole("group", { name: label });
  const value = group.querySelector(".tabular-nums");
  return (value?.firstChild?.textContent ?? value?.textContent ?? "").trim();
};

describe("ScorecardCard", () => {
  it("shows three axes and no composite", () => {
    card();
    expect(axis("Process")).toBe("72");
    expect(axis("Survival")).toBe("95");
    // No fourth number claiming to be the answer.
    expect(screen.queryByText(/Sickre/)).not.toBeInTheDocument();
  });

  it("states the edge in R with its interval, never as a score out of 100", () => {
    card();
    const edge = within(screen.getByRole("group", { name: "Edge" }));
    expect(edge.getByText("+1.00R")).toBeInTheDocument();
    expect(edge.getByText(/95 %:/)).toBeInTheDocument();
    expect(edge.getByText("n=6")).toBeInTheDocument();
    expect(edge.queryByText("/ 100")).not.toBeInTheDocument();
  });

  it("says out loud when the interval still includes zero", () => {
    card({ decidedRs: [3, -1, -1, 2, -1, -1] });
    expect(screen.getByText(/still includes zero/)).toBeInTheDocument();
  });

  it("draws an em dash for a withheld axis, and explains the gate", () => {
    card({ trades: 2, decidedRs: [1, 1] });
    expect(axis("Survival")).toBe("—");
    expect(axis("Edge")).toBe("—");
    expect(screen.getByText(/Survival needs 5 closed trades/)).toBeInTheDocument();
  });

  it("keeps process on screen for a book with nothing closed", () => {
    card({ trades: 0, decidedRs: [], trackerPct: 90, followRatePct: null });
    expect(axis("Process")).toBe("90");
    expect(axis("Survival")).toBe("—");
  });

  it("shows each axis's parts, with an em dash for the ones with no data", () => {
    card({ ftmoHeadroomPct: null });
    const survival = within(screen.getByRole("group", { name: "Survival" }));
    expect(survival.getByText("Max DD")).toBeInTheDocument();
    expect(survival.getByText("Under water")).toBeInTheDocument();
    // No prop-firm challenge: the part is named and left empty rather than
    // counted as full room.
    expect(survival.getByText("FTMO room")).toBeInTheDocument();
    expect(survival.getAllByText("—").length).toBeGreaterThanOrEqual(1);
  });

  it("marks a thin book without hiding its numbers", () => {
    card({ trades: 12 });
    expect(screen.getByText(/12 closed trades/)).toBeInTheDocument();
    expect(axis("Survival")).not.toBe("—");
  });
});
