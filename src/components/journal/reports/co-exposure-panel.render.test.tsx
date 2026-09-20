import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { CoExposurePanel } from "./co-exposure-panel";
import { MIN_SHARED_DAYS, type InstrumentPair } from "@/lib/journal/co-exposure";

const pair = (over: Partial<InstrumentPair> = {}): InstrumentPair => ({
  a: "US100.cash",
  b: "XAUUSD",
  overlapDays: 12,
  aDays: 20,
  bDays: 18,
  correlation: 0.74,
  correlationLo: 0.31,
  correlationHi: 0.91,
  sharedCloseDays: 9,
  ...over,
});

describe("CoExposurePanel", () => {
  it("leads with the exposure fact, not the coefficient", () => {
    render(<CoExposurePanel pairs={[pair()]} />);
    const row = screen.getByText(/US100.cash · XAUUSD/).closest("tr")!;
    expect(within(row).getByText("12")).toBeInTheDocument();
    expect(within(row).getByText("20 / 18")).toBeInTheDocument();
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
