import { describe, expect, it } from "vitest";
import {
  DASHBOARD_WIDGETS,
  WIDGET_IDS,
  getWidget,
  toggleWidget,
  visibleWidgets,
  widgetCounts,
} from "./dashboard-widgets";

/**
 * The two ways a display preference could break the page it decorates, closed.
 *
 * A stored array of strings is the least trustworthy input in this application:
 * it survives releases, it outlives the widgets it names, and a user can edit
 * it by hand in devtools. Everything below is one question asked repeatedly —
 * can any value in that array produce a dashboard that is blank, or one that
 * hides a warning about the reader's own money.
 */

describe("registry integrity", () => {
  it("has no duplicate ids", () => {
    expect(new Set(WIDGET_IDS).size).toBe(WIDGET_IDS.length);
  });

  it("gives every widget a label and a group", () => {
    for (const w of DASHBOARD_WIDGETS) {
      expect(w.label.length, w.id).toBeGreaterThan(0);
      expect(["headline", "detail", "charts", "process"], w.id).toContain(
        w.group,
      );
    }
  });

  it("locks exactly the three sections that must never be switched off", () => {
    const locked = DASHBOARD_WIDGETS.filter((w) => !w.hideable).map((w) => w.id);
    // Two warnings about the reader's money and the headline row. A page that
    // can be configured into lying is worse than one with no configuration.
    expect(locked.sort()).toEqual(["ftmo", "headline", "unpriced"]);
  });
});

describe("visibleWidgets", () => {
  it("shows everything when nothing is hidden", () => {
    expect(visibleWidgets([]).size).toBe(DASHBOARD_WIDGETS.length);
  });

  it("hides what the stored set names", () => {
    const v = visibleWidgets(["equity", "calendar"]);
    expect(v.has("equity")).toBe(false);
    expect(v.has("calendar")).toBe(false);
    expect(v.has("drawdown")).toBe(true);
  });

  it("KEEPS LOCKED WIDGETS however the store was written", () => {
    // Not merely un-clickable in the popover: a hand-edited localStorage value
    // naming them must still render them.
    const v = visibleWidgets(["ftmo", "unpriced", "headline"]);
    expect(v.has("ftmo")).toBe(true);
    expect(v.has("unpriced")).toBe(true);
    expect(v.has("headline")).toBe(true);
  });

  it("treats an unknown id as inert rather than blanking the page", () => {
    // A widget renamed in a release leaves its old id behind in every stored
    // preference. It must do nothing.
    const v = visibleWidgets(["a-widget-that-never-existed"]);
    expect(v.size).toBe(DASHBOARD_WIDGETS.length);
  });

  it("survives a store naming EVERY id — the headline row still renders", () => {
    const v = visibleWidgets(WIDGET_IDS);
    expect([...v].sort()).toEqual(["ftmo", "headline", "unpriced"]);
  });
});

describe("toggleWidget", () => {
  it("switches a widget off and back on", () => {
    const off = toggleWidget([], "equity");
    expect(off).toEqual(["equity"]);
    expect(toggleWidget(off, "equity")).toEqual([]);
  });

  it("refuses to hide a locked widget, without corrupting the set", () => {
    // Returned untouched rather than throwing: a caller asking for something
    // impossible gets a no-op, which is the behaviour that cannot cascade.
    expect(toggleWidget(["equity"], "headline")).toEqual(["equity"]);
    expect(toggleWidget([], "ftmo")).toEqual([]);
  });

  it("ignores an unknown id", () => {
    expect(toggleWidget(["equity"], "nope")).toEqual(["equity"]);
  });

  it("stores in registry order, so one selection has one representation", () => {
    // Clicked calendar first, then equity — but equity comes first in the
    // registry. Two identical dashboards must not differ by click order.
    const a = toggleWidget(toggleWidget([], "calendar"), "equity");
    const b = toggleWidget(toggleWidget([], "equity"), "calendar");
    expect(a).toEqual(b);
    expect(a.indexOf("equity")).toBeLessThan(a.indexOf("calendar"));
  });
});

describe("widgetCounts", () => {
  it("counts only the hideable ones — the badge measures what the reader can change", () => {
    const total = DASHBOARD_WIDGETS.filter((w) => w.hideable).length;
    expect(widgetCounts([])).toEqual({ visible: total, total });
    expect(widgetCounts(["equity"])).toEqual({ visible: total - 1, total });
  });

  it("is unmoved by a locked id in the stored set", () => {
    const total = DASHBOARD_WIDGETS.filter((w) => w.hideable).length;
    expect(widgetCounts(["headline"])).toEqual({ visible: total, total });
  });
});

describe("getWidget", () => {
  it("finds by id and answers undefined for anything else", () => {
    expect(getWidget("equity")?.label).toBe("Equity curve");
    expect(getWidget("nope")).toBeUndefined();
  });
});
