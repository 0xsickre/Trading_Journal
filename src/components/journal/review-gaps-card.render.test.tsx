import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewGapsCard } from "./review-gaps-card";

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
