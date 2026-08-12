import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChartShell } from "./chart-shell";

describe("ChartShell — chrome around a chart, empty state takes priority", () => {
  it("renders title, subtitle and action alongside the children", () => {
    render(
      <ChartShell title="Equity" subtitle="poslednjih 90 dana" action={<button>Izvoz</button>}>
        <div>chart body</div>
      </ChartShell>,
    );
    expect(screen.getByText("Equity")).toBeInTheDocument();
    expect(screen.getByText("poslednjih 90 dana")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Izvoz" })).toBeInTheDocument();
    expect(screen.getByText("chart body")).toBeInTheDocument();
  });

  it("`empty` replaces the children entirely rather than rendering alongside them", () => {
    render(
      <ChartShell title="Equity" empty={<p>No data</p>}>
        <div>chart body</div>
      </ChartShell>,
    );
    expect(screen.getByText("No data")).toBeInTheDocument();
    expect(screen.queryByText("chart body")).not.toBeInTheDocument();
  });
});
