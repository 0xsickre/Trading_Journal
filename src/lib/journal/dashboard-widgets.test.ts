import { describe, expect, it } from "vitest";
import {
  DASHBOARD_WIDGETS,
  WIDGET_IDS,
  getWidget,
  packRows,
  resolveOrder,
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

describe("resolveOrder", () => {
  it("returns the registry order when nothing is stored", () => {
    expect(resolveOrder([]).map((w) => w.id)).toEqual(WIDGET_IDS);
  });

  it("honours the stored order and appends whatever it never mentioned", () => {
    // The half the guard exists for: a widget added in a release is absent from
    // every stored order, and must still reach the page.
    const ids = resolveOrder(["calendar", "equity"]).map((w) => w.id);
    expect(ids[0]).toBe("calendar");
    expect(ids[1]).toBe("equity");
    expect(ids).toHaveLength(WIDGET_IDS.length);
    expect(new Set(ids).size).toBe(WIDGET_IDS.length);
  });

  it("drops ids the registry no longer knows", () => {
    const ids = resolveOrder(["ghost-widget", "equity"]).map((w) => w.id);
    expect(ids).not.toContain("ghost-widget");
    expect(ids[0]).toBe("equity");
  });

  it("renders a duplicated id once, not twice", () => {
    // A hand-edited array can name the same widget twice; rendering it twice
    // would duplicate a whole section of the page.
    const ids = resolveOrder(["equity", "equity"]).map((w) => w.id);
    expect(ids.filter((i) => i === "equity")).toHaveLength(1);
  });

  it("never loses a widget, whatever the stored value", () => {
    for (const stored of [[], ["nope"], WIDGET_IDS, [...WIDGET_IDS].reverse()]) {
      expect(resolveOrder(stored)).toHaveLength(WIDGET_IDS.length);
    }
  });
});

describe("packRows", () => {
  const spans = (rows: { span: number }[][]) => rows.map((r) => r.map((w) => w.span));

  it("REPRODUCES THE DEFAULT LAYOUT from the registry order", () => {
    // The assertion that made the extraction safe: rendering from this list has
    // to produce the same rows the hand-written JSX did. Measured against the
    // running page — equity beside score, four cards in one row.
    const rows = packRows(resolveOrder([]));
    for (const row of rows) {
      expect(row.reduce((s, w) => s + w.span, 0)).toBeLessThanOrEqual(4);
    }
    const byId = rows.map((r) => r.map((w) => w.id));
    expect(byId).toContainEqual(["equity", "score"]);
    expect(byId).toContainEqual(["hold-time", "costs", "plan-vs-reality", "weekly"]);
    expect(byId).toContainEqual(["drawdown", "calendar"]);
  });

  it("fills a row to four quarters and then opens a new one", () => {
    const w = (id: string, span: 1 | 2 | 4) =>
      ({ id, label: id, group: "detail", span, hideable: true }) as const;
    expect(
      spans(packRows([w("a", 2), w("b", 1), w("c", 1), w("d", 2)])),
    ).toEqual([[2, 1, 1], [2]]);
  });

  it("gives a full-width widget its own row", () => {
    const w = (id: string, span: 1 | 2 | 4) =>
      ({ id, label: id, group: "detail", span, hideable: true }) as const;
    expect(spans(packRows([w("a", 1), w("b", 4), w("c", 1)]))).toEqual([
      [1],
      [4],
      [1],
    ]);
  });

  it("NEVER REORDERS to make a tidier fit", () => {
    // A 2 followed by two 1s packs as 2+1+1. A 1, a 4 and a 1 could fit as
    // 1+1 then 4 — and must not, because the reader's sequence is the one thing
    // this function may not second-guess.
    const w = (id: string, span: 1 | 2 | 4) =>
      ({ id, label: id, group: "detail", span, hideable: true }) as const;
    const flat = packRows([w("a", 1), w("b", 4), w("c", 1)]).flat().map((x) => x.id);
    expect(flat).toEqual(["a", "b", "c"]);
  });

  it("packs nothing into nothing", () => {
    expect(packRows([])).toEqual([]);
  });
});

describe("getWidget", () => {
  it("finds by id and answers undefined for anything else", () => {
    expect(getWidget("equity")?.label).toBe("Equity curve");
    expect(getWidget("nope")).toBeUndefined();
  });
});
