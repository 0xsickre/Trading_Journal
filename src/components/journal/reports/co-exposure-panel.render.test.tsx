import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { CoExposurePanel } from "./co-exposure-panel";
import { MIN_SHARED_DAYS, type InstrumentPair } from "@/lib/journal/co-exposure";

const pair = (over: Partial<InstrumentPair> = {}): InstrumentPair => ({
  a: "ES",
  b: "NQ",
  overlapMinutes: 45,
  aMinutes: 90,
  bMinutes: 75,
  correlation: 0.74,
  correlationLo: 0.31,
  correlationHi: 0.91,
  sharedCloseDays: 9,
  ...over,
});

describe("CoExposurePanel", () => {
  it("leads with the exposure fact, not the coefficient", () => {
    render(<CoExposurePanel pairs={[pair()]} />);
    const row = screen.getByText(/ES · NQ/).closest("tr")!;
    expect(within(row).getByText("45m")).toBeInTheDocument();
    expect(within(row).getByText("1h 30m / 1h 15m")).toBeInTheDocument();
  });

  it("shows a coefficient with its interval once there are enough shared days", () => {
    render(<CoExposurePanel pairs={[pair()]} />);
    expect(screen.getByText("0.74")).toBeInTheDocument();
    expect(screen.getByText("0.31 – 0.91")).toBeInTheDocument();
  });

  it("withholds the coefficient below the gate, and says how many days it had", () => {
    render(
      <CoExposurePanel
        pairs={[pair({ correlation: null, correlationLo: null, correlationHi: null, sharedCloseDays: 3 })]}
      />,
    );
    expect(screen.queryByText("0.74")).not.toBeInTheDocument();
    expect(
      screen.getByTitle(new RegExp(`Needs ${MIN_SHARED_DAYS} days .* this pair has 3`)),
    ).toBeInTheDocument();
  });

  it("renders nothing at all with no pairs to compare", () => {
    const { container } = render(<CoExposurePanel pairs={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
