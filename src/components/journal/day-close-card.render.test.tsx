import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DayCloseCard } from "./day-close-card";
import type { DayClose } from "@/lib/journal/day-close";

const EMPTY: DayClose = { closed: 0, best: null, worst: null, mistakes: [] };

describe("DayCloseCard (phase B7)", () => {
  it("says so on a day with nothing closed", () => {
    render(<DayCloseCard close={EMPTY} currency="USD" />);
    expect(screen.getByText("Nema zatvorenih trejdova ovog dana.")).toBeInTheDocument();
  });

  it("links the best and the worst, flags the missing chart and marks an auto mistake", () => {
    const close: DayClose = {
      closed: 2,
      best: { id: "t1", label: "#1", net: 50, r: 0.5, hasChart: true },
      worst: { id: "t2", label: "#2", net: -120, r: -1.2, hasChart: false },
      mistakes: [{ tag: "Pomerio stop", trades: 1, net: -120, r: -1.2, auto: true }],
    };
    render(<DayCloseCard close={close} currency="USD" />);
    expect(screen.getByRole("link", { name: "#1" })).toHaveAttribute("href", "/trades/t1?from=daily");
    expect(screen.getByRole("link", { name: "#2" })).toBeInTheDocument();
    expect(screen.getByText("fali slika")).toBeInTheDocument();
    expect(screen.getByText("Pomerio stop")).toBeInTheDocument();
    expect(screen.getByText("auto")).toBeInTheDocument();
  });

  it("one trade alone is named once, and a clean day says so", () => {
    const only = { id: "t1", label: "#1", net: -30, r: null, hasChart: true };
    render(<DayCloseCard close={{ closed: 1, best: only, worst: only, mistakes: [] }} currency="USD" />);
    expect(screen.getByText(/Jedini trejd/)).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByText("Nijedna — ni ručna ni automatska.")).toBeInTheDocument();
  });
});
