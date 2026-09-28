import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProgressCard } from "./progress-card";
import { ReviewGapsCard } from "./review-gaps-card";
import type { ProgressRow, ProgressSummary } from "@/lib/journal/progress";

const rowOf = (key: string, label: string, n: number, net: number, avgR: number | null): ProgressRow => ({
  key,
  label,
  n,
  net,
  avgR,
  sumR: (avgR ?? 0) * n,
  winRate: 0.5,
});

const EMPTY: ProgressSummary = {
  total: rowOf("all", "All trades", 0, 0, null),
  setups: [],
  mistakes: [],
  grades: [],
  hours: [],
  order: [],
  afterLoss: null,
  excursion: { winnersMaeR: null, losersMfeR: null, capture: null, n: 0 },
};

describe("ProgressCard", () => {
  it("an empty week says so", () => {
    render(<ProgressCard week={EMPTY} prev={EMPTY} currency="USD" />);
    expect(screen.getByText("Nema zatvorenih trejdova ove nedelje.")).toBeInTheDocument();
  });

  it("shows the six answers with last week's R beside them", () => {
    const week: ProgressSummary = {
      ...EMPTY,
      total: rowOf("all", "All trades", 4, 150, 0.4),
      setups: [rowOf("orb", "OR breakout", 3, 250, 1.1)],
      mistakes: [rowOf("Moved stop", "Moved stop", 1, -150, -1.5)],
      grades: [rowOf("A", "A — by plan", 3, 300, 1)],
      hours: [rowOf("15", "15:00–15:59", 4, 150, 0.4)],
      order: [rowOf("1", "1st of the day", 2, 300, 1.5)],
      afterLoss: rowOf("after_loss", "After a loss that day", 1, -100, -1),
      excursion: { winnersMaeR: 0.45, losersMfeR: 0.8, capture: 62, n: 4 },
    };
    const prev = { ...EMPTY, setups: [rowOf("orb", "OR breakout", 2, -50, -0.25)] };
    render(<ProgressCard week={week} prev={prev} currency="USD" />);
    expect(screen.getByText("OR breakout")).toBeInTheDocument();
    expect(screen.getByText("-0.25 R")).toBeInTheDocument();
    expect(screen.getByText("Moved stop")).toBeInTheDocument();
    expect(screen.getByText("After a loss that day")).toBeInTheDocument();
    expect(screen.getByText("−0.45 R")).toBeInTheDocument();
    expect(screen.getByText("62%")).toBeInTheDocument();
    expect(screen.getByText(/mali uzorak/)).toBeInTheDocument();
  });
});

describe("ReviewGapsCard", () => {
  it("renders nothing on a finished day", () => {
    const { container } = render(<ReviewGapsCard gaps={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("links every gap to its short review", () => {
    render(<ReviewGapsCard gaps={[{ id: "p1", label: "#8 MNQ", missing: ["setup", "grade"] }]} />);
    expect(screen.getByText(/fali setup i ocena/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pregledaj" })).toHaveAttribute("href", "/trades/p1/review");
  });
});
