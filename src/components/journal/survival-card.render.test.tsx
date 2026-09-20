import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SurvivalCard } from "./survival-card";
import { MIN_SAMPLE_DAYS, type SurvivalResult } from "@/lib/journal/survival";

/**
 * This is the only card on the page whose number is not a measurement, so what
 * is pinned here is that it never pretends to be one: the assumptions are on
 * screen, and a book too short to simulate says so instead of printing a
 * probability.
 */

const result = (over: Partial<SurvivalResult> = {}): SurvivalResult => ({
  pMaxLoss: 12.5,
  pDailyLoss: 3,
  pTarget: 44,
  pNegative: 38,
  percentiles: { p5: -14.2, p25: -4.1, p50: 3.6, p75: 11.8, p95: 26.4 },
  medianWorstDrawdownPct: 7.9,
  sampleDays: 84,
  iters: 2000,
  ...over,
});

describe("SurvivalCard", () => {
  it("says what it cannot answer on a book too short to resample", () => {
    render(<SurvivalCard result={null} horizonDays={60} blockDays={1} limitLabel="the floor" />);
    expect(screen.getByText(new RegExp(`${MIN_SAMPLE_DAYS} days`))).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it("names the floor it is measuring against, so the number cannot be misread", () => {
    render(
      <SurvivalCard result={result()} horizonDays={60} blockDays={1} limitLabel="a 10% drawdown" />,
    );
    expect(screen.getByText("Hits a 10% drawdown")).toBeInTheDocument();
    expect(screen.getByText("12.5%")).toBeInTheDocument();
  });

  it("states its assumptions beside the figures", () => {
    render(<SurvivalCard result={result()} horizonDays={60} blockDays={5} limitLabel="the floor" />);
    // How many runs, over how much history, drawn how — and what it disclaims.
    expect(screen.getByText(/2,000 runs/)).toBeInTheDocument();
    expect(screen.getByText(/84 trading days/)).toBeInTheDocument();
    expect(screen.getByText(/blocks of five days/)).toBeInTheDocument();
    expect(screen.getByText(/does not predict a market/)).toBeInTheDocument();
  });

  it("leaves out a rule the account does not have", () => {
    render(
      <SurvivalCard
        result={result({ pDailyLoss: null, pTarget: null })}
        horizonDays={60}
        blockDays={1}
        limitLabel="a 10% drawdown"
      />,
    );
    expect(screen.queryByText("Breaks a daily limit")).not.toBeInTheDocument();
    expect(screen.queryByText("Reaches the target")).not.toBeInTheDocument();
    // What it can still answer without any challenge rules at all.
    expect(screen.getByText("Ends below today")).toBeInTheDocument();
  });

  it("switches between single days and weekly blocks", async () => {
    const user = userEvent.setup({ delay: null });
    const onBlockChange = vi.fn();
    render(
      <SurvivalCard
        result={result()}
        horizonDays={60}
        blockDays={1}
        limitLabel="the floor"
        onBlockChange={onBlockChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Single days" }));
    expect(onBlockChange).toHaveBeenCalledWith(5);
  });
});
