import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TopstepBanner } from "./topstep-banner";
import { evaluateTopstep, type TopstepConfig, type TopstepResult } from "@/lib/journal/topstep";
import type { Account } from "@/lib/journal/types";

const account = (stage: "combine" | "xfa") =>
  ({ id: "a", name: "Topstep 50K", currency: "USD", topstep_plan: "50K", topstep_stage: stage }) as unknown as Account;

const cfg = (stage: "combine" | "xfa"): TopstepConfig => ({
  enabled: true,
  plan: "50K",
  stage,
  startingBalance: stage === "xfa" ? 0 : 50_000,
  payoutAt: null,
  resetAt: null,
  personalDll: null,
  dailyTarget: null,
});

const trades = ["2026-09-23", "2026-09-24", "2026-09-25", "2026-09-28", "2026-09-29"].map((d) => ({
  closedAt: `${d}T15:00:00Z`,
  net: 400,
}));
const result = (stage: "combine" | "xfa") =>
  evaluateTopstep(cfg(stage), trades, "2026-09-30T15:00:00Z") as TopstepResult;

describe("TopstepBanner on an Express Funded Account (phase T)", () => {
  it("shows the Scaling Plan's contracts and both payout paths, not a target", () => {
    render(<TopstepBanner account={account("xfa")} result={result("xfa")} />);
    // $2 000 at the last close: five minis on a 50K.
    expect(screen.getByText(/Contracts today: 5 mini \/ 50 micro/)).toBeTruthy();
    expect(screen.getByText(/Payout, Standard: 5 of 5 days/)).toBeTruthy();
    expect(screen.getAllByText(/ready, up to \$1,000/)).toHaveLength(2);           // half of $2 000, both paths
    expect(screen.getByText(/Payout, Consistency: 5 of 3 days, best day 20 %/)).toBeTruthy();
    expect(screen.queryByText(/target/i)).toBeNull();
    expect(screen.getByText(/XFA/)).toBeTruthy();
  });

  it("a Combine keeps its target and best day", () => {
    render(<TopstepBanner account={account("combine")} result={result("combine")} />);
    expect(screen.getByText(/of \$3,000(\.00)? target/)).toBeTruthy();
    expect(screen.queryByText(/Payout, Standard/)).toBeNull();
  });
});
