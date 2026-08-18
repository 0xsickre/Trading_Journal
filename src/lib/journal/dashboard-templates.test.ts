import { describe, expect, it } from "vitest";
import { DASHBOARD_WIDGETS, resolveOrder } from "./dashboard-widgets";
import {
  layoutToWidgets,
  normalizeTemplateName,
  templateMatchesLayout,
  widgetsToLayout,
  type DashboardTemplate,
} from "./dashboard-templates";

/**
 * The round trip a saved arrangement has to survive.
 *
 * A template is written in one shape (visible ids, in order) and read back into
 * another (a hidden set plus an order). Everything below asks the same question
 * from a different side: does what the reader saved come back, and does the app
 * know when it has stopped matching.
 */

const movable = DASHBOARD_WIDGETS.filter((w) => w.hideable).map((w) => w.id);
const tpl = (widgets: string[]): DashboardTemplate => ({
  id: "t1",
  name: "Test",
  widgets,
});

describe("layoutToWidgets", () => {
  it("lists what is visible, in page order", () => {
    expect(layoutToWidgets([], [])).toEqual(movable);
  });

  it("omits what is hidden", () => {
    const out = layoutToWidgets(["equity", "calendar"], []);
    expect(out).not.toContain("equity");
    expect(out).not.toContain("calendar");
    expect(out).toHaveLength(movable.length - 2);
  });

  it("NEVER STORES A LOCKED WIDGET", () => {
    // They are shown on every layout by definition. Recording them would put a
    // fact about the application inside a row describing the reader's choice.
    const out = layoutToWidgets([], []);
    for (const w of DASHBOARD_WIDGETS.filter((x) => !x.hideable)) {
      expect(out).not.toContain(w.id);
    }
  });

  it("follows the stored order", () => {
    const out = layoutToWidgets([], ["tag-breakdown", "equity"]);
    expect(out[0]).toBe("tag-breakdown");
    expect(out[1]).toBe("equity");
  });
});

describe("widgetsToLayout", () => {
  it("round-trips a layout through a template unchanged", () => {
    const hidden = ["equity", "calendar"];
    const order = ["tag-breakdown", "score"];
    const widgets = layoutToWidgets(hidden, order);
    const back = widgetsToLayout(widgets);
    expect(layoutToWidgets(back.hidden, back.order)).toEqual(widgets);
  });

  it("HIDES A WIDGET THE TEMPLATE NEVER NAMED — that is the freeze", () => {
    // A section added after the template was saved does not appear in it. The
    // migration says so outright: a widget showing up because there was a
    // release is not the arrangement the reader saved.
    const back = widgetsToLayout(["equity", "score"]);
    expect(back.hidden).toContain("calendar");
    expect(back.hidden).not.toContain("equity");
  });

  it("drops ids the registry no longer knows", () => {
    // A template written before a rename must not be able to hide everything.
    const back = widgetsToLayout(["ghost", "equity"]);
    expect(back.order).toEqual(["equity"]);
    expect(back.hidden).not.toContain("ghost");
  });

  it("survives an empty template without blanking the locked sections", () => {
    const back = widgetsToLayout([]);
    expect(back.hidden).toEqual(movable);
    // Locked ones are never in `hidden`, so `visibleWidgets` still shows them.
    expect(resolveOrder(back.order).filter((w) => !w.hideable)).toHaveLength(
      DASHBOARD_WIDGETS.filter((w) => !w.hideable).length,
    );
  });
});

describe("templateMatchesLayout", () => {
  it("matches the layout it was made from", () => {
    const hidden = ["equity"];
    const order = ["tag-breakdown"];
    expect(
      templateMatchesLayout(tpl(layoutToWidgets(hidden, order)), hidden, order),
    ).toBe(true);
  });

  it("stops matching when a section is switched off", () => {
    const t = tpl(layoutToWidgets([], []));
    expect(templateMatchesLayout(t, ["equity"], [])).toBe(false);
  });

  it("stops matching when a section is MOVED, not only hidden", () => {
    // Order is half of what a saved arrangement is. A comparison that only
    // looked at the visible set would call a rearranged page unchanged.
    const t = tpl(layoutToWidgets([], []));
    expect(templateMatchesLayout(t, [], ["tag-breakdown"])).toBe(false);
  });

  it("ignores an id the registry has dropped since the template was saved", () => {
    // The comparison is about what RENDERS, not about what is written.
    const t = tpl(["ghost", ...layoutToWidgets([], [])]);
    expect(templateMatchesLayout(t, [], [])).toBe(true);
  });
});

describe("normalizeTemplateName", () => {
  it("trims, and refuses what the column's CHECK would refuse", () => {
    expect(normalizeTemplateName("  Swing  ")).toBe("Swing");
    expect(normalizeTemplateName("")).toBeNull();
    expect(normalizeTemplateName("   ")).toBeNull();
    expect(normalizeTemplateName("x".repeat(61))).toBeNull();
    expect(normalizeTemplateName("x".repeat(60))).toHaveLength(60);
  });
});
