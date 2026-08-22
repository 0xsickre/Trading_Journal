import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DailyStreakStrip } from "./daily-streak-strip";

/**
 * The strip exists to answer one question — am I on a run — and to avoid
 * answering a second one it has no business answering: whether a window with
 * nothing scored means the reader is at zero.
 */

const base = { current: 0, meanPct: null, scoredDays: 0, hasRules: true };

describe("DailyStreakStrip", () => {
  it("reads the run and the consistency together", () => {
    render(<DailyStreakStrip {...base} current={5} meanPct={82} scoredDays={20} />);
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("dana zaredom")).toBeInTheDocument();
    expect(screen.getByText("82%")).toBeInTheDocument();
  });

  it("SAYS NOTHING IS SCORED YET rather than reporting zero percent", () => {
    // A window with no verdicts has no average. Printing "0%" would be a
    // judgement on days the reader never had scored — the same distinction the
    // gauge keeps by drawing an empty arc instead of a filled one at zero.
    render(<DailyStreakStrip {...base} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  it("still prints a real zero when zero is what was measured", () => {
    // The other half of the distinction above: 0 % is a legitimate reading, and
    // must not be swallowed by the same dash that means "no data".
    render(<DailyStreakStrip {...base} meanPct={0} scoredDays={12} />);
    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });

  it("draws an empty gauge for no data and a filled one for zero", () => {
    // `SemiGauge` renders the fill path only when it has a fraction, so the two
    // states differ in the DOM and not only in the text beside them.
    const { container: none } = render(<DailyStreakStrip {...base} />);
    const { container: zero } = render(
      <DailyStreakStrip {...base} meanPct={0} scoredDays={12} />,
    );
    const paths = (c: HTMLElement) =>
      c.querySelectorAll('[data-viz="semi-gauge"] path').length;
    expect(paths(none)).toBeLessThan(paths(zero));
  });

  it("uses the singular for a one-day run", () => {
    render(<DailyStreakStrip {...base} current={1} />);
    expect(screen.getByText("dan zaredom")).toBeInTheDocument();
  });

  it("RENDERS NOTHING BEFORE ANY RULE EXISTS, which is not a broken streak", () => {
    // "You have not set this up" and "your streak is zero" are different
    // sentences, and only one of them is the reader's fault.
    const { container } = render(<DailyStreakStrip {...base} hasRules={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});
