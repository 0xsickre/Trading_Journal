import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InsightsPanel } from "./insights-panel";
import { OMITTED_RULES, type RunResult } from "@/lib/journal/insights/registry";
import type { Insight } from "@/lib/journal/insights/types";

const insight = (over: Partial<Insight> & Pick<Insight, "ruleId" | "severity" | "title">): Insight => ({
  level: "trade",
  detail: "detalj",
  subjectId: "t1",
  ...over,
});

describe("InsightsPanel — grouped by rule, not a flat wall of lines", () => {
  it("tallies severity counts across all insights, not per group", () => {
    const result: RunResult = {
      insights: [
        insight({ ruleId: "r1", severity: "critical", title: "A", subjectId: "t1" }),
        insight({ ruleId: "r1", severity: "critical", title: "A", subjectId: "t2" }),
        insight({ ruleId: "r2", severity: "good", title: "B", subjectId: "t3" }),
      ],
      skipped: [],
    };
    render(<InsightsPanel result={result} />);
    expect(screen.getByText("Critical 2")).toBeInTheDocument();
    expect(screen.getByText("Good 1")).toBeInTheDocument();
    expect(screen.queryByText(/^Warning/)).not.toBeInTheDocument();
  });

  it("a rule fired twice collapses to one row, expandable to both instances", async () => {
    const user = userEvent.setup({ delay: null });
    const result: RunResult = {
      insights: [
        insight({ ruleId: "r1", severity: "warning", title: "Green to red", subjectId: "t1", subjectLabel: "#1 EURUSD" }),
        insight({ ruleId: "r1", severity: "warning", title: "Green to red", subjectId: "t2", subjectLabel: "#2 XAUUSD" }),
      ],
      skipped: [],
    };
    render(<InsightsPanel result={result} />);

    expect(screen.getByText("Green to red")).toBeInTheDocument();
    expect(screen.getByText("2×")).toBeInTheDocument();
    expect(screen.queryByText("#1 EURUSD")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Green to red/ }));
    expect(screen.getByText("#1 EURUSD")).toBeInTheDocument();
    expect(screen.getByText("#2 XAUUSD")).toBeInTheDocument();
  });

  it("empty insights shows the explicit 'nothing fired' sentence, not a blank panel", () => {
    render(<InsightsPanel result={{ insights: [], skipped: [] }} />);
    expect(screen.getByText(/No pattern fired/)).toBeInTheDocument();
  });

  it("skipped rules and omitted rules are counted together and listed on demand", async () => {
    const user = userEvent.setup({ delay: null });
    const result: RunResult = {
      insights: [],
      skipped: [{ id: "thin_rule", minSample: 10, sample: 3 }],
    };
    render(<InsightsPanel result={result} />);

    const toggle = screen.getByRole("button", {
      name: `What was not assessed (${1 + OMITTED_RULES.length})`,
    });
    expect(toggle).toBeInTheDocument();
    expect(screen.queryByText("thin_rule")).not.toBeInTheDocument();

    await user.click(toggle);
    expect(screen.getByText("thin_rule")).toBeInTheDocument();
    expect(screen.getByText(/needs 10, has 3/)).toBeInTheDocument();
    // At least one deliberately-omitted rule is always listed alongside it.
    expect(OMITTED_RULES.length).toBeGreaterThan(0);
    expect(screen.getByText(OMITTED_RULES[0].id)).toBeInTheDocument();
  });
});
