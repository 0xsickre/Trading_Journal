import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { StatGroup } from "./stat-group";

/**
 * THE KPI TILE BLOCK — AND THE INVARIANT THAT PROTECTS EVERY OTHER TEST.
 *
 * The component looks like decoration, but it carries the claim the reliability
 * of `dashboard.render.test.tsx` depends on: WITH NO SAVED PREFERENCE THE GROUP
 * IS OPEN.
 *
 * Nine claims about KPI numbers on the dashboard look for text inside these
 * groups. If the default state were collapsed — or if `localStorage` were read
 * during render instead of in an effect — a headless render would meet a
 * collapsed group and quietly NOT FIND a tile that really is on the page. Nine
 * checks on numbers would go dark without a single red test.
 *
 * So this file checks exactly that, not the looks.
 */

const KEY = "tj:dashboard_prefs";

afterEach(() => {
  localStorage.clear();
});

const draw = (props: Partial<Parameters<typeof StatGroup>[0]> = {}) =>
  render(
    <StatGroup id="risk" title="Risk" count={3} {...props}>
      <div>Max DD</div>
      <div>Sharpe</div>
      <div>Sortino</div>
    </StatGroup>,
  );

describe("the default state is open", () => {
  it("with no saved preference at all the content is in the document", () => {
    draw();
    expect(screen.getByText("Max DD")).toBeInTheDocument();
    expect(screen.getByText("Sortino")).toBeInTheDocument();
  });

  it("the button reports the open state to assistive technology", () => {
    draw();
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "true");
  });

  it("A PREFERENCE FOR ANOTHER GROUP does not close this one", () => {
    // This is the real protection for the dashboard tests: one collapsed group
    // must not drag the others down with it.
    localStorage.setItem(KEY, JSON.stringify({ collapsedGroups: ["quality"] }));
    draw({ id: "risk" });
    expect(screen.getByText("Max DD")).toBeInTheDocument();
  });

  it("a broken preference leaves the group open", () => {
    // The defence from `dashboard-prefs.ts` has to show here too: an invalid
    // value must not hide a metric.
    localStorage.setItem(KEY, "{ ovo nije json");
    draw();
    expect(screen.getByText("Max DD")).toBeInTheDocument();
  });

  it("the title and the tile count stand while the group is open too", () => {
    // The count is there so a collapsed group still says what it holds. It must
    // not disappear when open, or the user would see it in only one of the two
    // states.
    draw();
    expect(screen.getByText("Risk")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});

describe("saved collapsing", () => {
  it("a group remembered as collapsed closes after hydration", () => {
    localStorage.setItem(KEY, JSON.stringify({ collapsedGroups: ["risk"] }));
    draw({ id: "risk" });
    expect(screen.queryByText("Max DD")).not.toBeInTheDocument();
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "false");
    // Title and count stay — a collapsed group still says what it holds.
    expect(screen.getByText("Risk")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("a click collapses and WRITES the preference", () => {
    draw();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByText("Max DD")).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(KEY) ?? "{}")).toEqual({
      collapsedGroups: ["risk"],
    });
  });

  it("a second click opens and REMOVES the preference", () => {
    localStorage.setItem(KEY, JSON.stringify({ collapsedGroups: ["risk"] }));
    draw();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("Max DD")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(KEY) ?? "{}")).toEqual({
      collapsedGroups: [],
    });
  });

  it("collapsing one group leaves another one in the same store alone", () => {
    localStorage.setItem(KEY, JSON.stringify({ collapsedGroups: ["quality"] }));
    draw({ id: "risk" });
    fireEvent.click(screen.getByRole("button"));
    expect(JSON.parse(localStorage.getItem(KEY) ?? "{}").collapsedGroups).toEqual(
      ["quality", "risk"],
    );
  });
});

describe("group identity", () => {
  it("a renamed `id` opens the group again", () => {
    // Deliberate: better open than wrongly collapsed under someone else's key —
    // a metric that cannot be seen is worse than a group shown needlessly.
    localStorage.setItem(KEY, JSON.stringify({ collapsedGroups: ["risk"] }));
    draw({ id: "risk-v2" });
    expect(screen.getByText("Max DD")).toBeInTheDocument();
  });

  it("zero tiles is allowed and does not break the render", () => {
    render(
      <StatGroup id="empty" title="Empty" count={0}>
        {null}
      </StatGroup>,
    );
    expect(screen.getByText("Empty")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
  });
});
