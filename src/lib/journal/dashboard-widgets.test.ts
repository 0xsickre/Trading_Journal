import { describe, expect, it } from "vitest";
import {
  DASHBOARD_WIDGETS,
  WIDGET_IDS,
  canMoveWidget,
  getWidget,
  moveWidget,
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
    const movable = ids.filter((id) => getWidget(id)!.hideable);
    expect(movable[0]).toBe("calendar");
    expect(movable[1]).toBe("equity");
    expect(ids).toHaveLength(WIDGET_IDS.length);
    expect(new Set(ids).size).toBe(WIDGET_IDS.length);
  });

  it("PUTS LOCKED WIDGETS FIRST whatever the stored array says", () => {
    // They are drawn above the rows and never inside them, so any other
    // placement describes a page that cannot exist — and the picker, which
    // renders straight from this list, would show "Always on" rows floating in
    // the middle of the sequence.
    const ids = resolveOrder(["tag-breakdown", "equity"]).map((w) => w.id);
    expect(ids.slice(0, 3)).toEqual(
      DASHBOARD_WIDGETS.filter((w) => !w.hideable).map((w) => w.id),
    );
    expect(ids[3]).toBe("tag-breakdown");
  });

  it("drops ids the registry no longer knows", () => {
    const ids = resolveOrder(["ghost-widget", "equity"]).map((w) => w.id);
    expect(ids).not.toContain("ghost-widget");
    expect(ids.filter((id) => getWidget(id)!.hideable)[0]).toBe("equity");
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

describe("moveWidget", () => {
  /** Movable ids only — the sequence the reader actually sees rearranged. */
  const movable = (order: string[]) =>
    resolveOrder(order).filter((w) => w.hideable).map((w) => w.id);

  it("materializes a FULL order from an empty one", () => {
    // The stored value is usually empty, meaning "the registry's". A sparse
    // edit of an empty array cannot express a move at all.
    const next = moveWidget([], "score", -1);
    expect(next).toHaveLength(WIDGET_IDS.length);
    expect(new Set(next).size).toBe(WIDGET_IDS.length);
  });

  it("swaps a widget with its neighbour", () => {
    const before = movable([]);
    const next = movable(moveWidget([], "score", -1));
    const i = before.indexOf("score");
    expect(next[i - 1]).toBe("score");
    expect(next[i]).toBe(before[i - 1]);
  });

  it("moves down as well as up, and the two undo each other", () => {
    // Down then up must land exactly back on the registry order — otherwise a
    // reader who nudges a section and changes their mind cannot get back.
    const original = resolveOrder([]).map((w) => w.id);
    const down = moveWidget([], "equity", 1);
    expect(down).not.toEqual(original);
    expect(moveWidget(down, "equity", -1)).toEqual(original);
  });

  it("clamps at both ends rather than wrapping", () => {
    // A widget at the top that jumps to the bottom on one more click is a
    // surprise, not a feature.
    const first = movable([])[0];
    const last = movable([]).at(-1)!;
    expect(movable(moveWidget([], first, -1))[0]).toBe(first);
    expect(movable(moveWidget([], last, 1)).at(-1)).toBe(last);
  });

  it("REFUSES TO MOVE A LOCKED WIDGET", () => {
    expect(moveWidget([], "headline", 1)).toEqual(
      resolveOrder([]).map((w) => w.id),
    );
  });

  it("steps OVER locked widgets instead of trading places with one", () => {
    // The locked three render above the rows and never inside them, so swapping
    // with one would rewrite the array and change nothing on screen — a button
    // that visibly does nothing.
    const first = movable([])[0];
    const next = moveWidget([], first, 1);
    // The locked ids keep the front; the movable sequence is what changed.
    expect(next.slice(0, 3)).toEqual(
      DASHBOARD_WIDGETS.filter((w) => !w.hideable).map((w) => w.id),
    );
    expect(movable(next)[1]).toBe(first);
  });

  it("ignores an unknown id", () => {
    expect(moveWidget([], "nope", 1)).toEqual(resolveOrder([]).map((w) => w.id));
  });
});

describe("canMoveWidget", () => {
  const movable = resolveOrder([]).filter((w) => w.hideable).map((w) => w.id);

  it("says no at the ends and yes in the middle", () => {
    expect(canMoveWidget([], movable[0], -1)).toBe(false);
    expect(canMoveWidget([], movable[0], 1)).toBe(true);
    expect(canMoveWidget([], movable.at(-1)!, 1)).toBe(false);
    expect(canMoveWidget([], movable.at(-1)!, -1)).toBe(true);
  });

  it("says no for a locked widget in either direction", () => {
    expect(canMoveWidget([], "headline", -1)).toBe(false);
    expect(canMoveWidget([], "headline", 1)).toBe(false);
  });

  it("agrees with moveWidget — a refused move leaves the order alone", () => {
    // The chevron is greyed out on exactly the moves that would be no-ops, so
    // the two must not be able to disagree.
    for (const id of [...movable, "headline", "nope"]) {
      for (const dir of [-1, 1] as const) {
        const changed =
          moveWidget([], id, dir).join() !== resolveOrder([]).map((w) => w.id).join();
        expect(changed, `${id} ${dir}`).toBe(canMoveWidget([], id, dir));
      }
    }
  });
});

describe("getWidget", () => {
  it("finds by id and answers undefined for anything else", () => {
    expect(getWidget("equity")?.label).toBe("Equity curve");
    expect(getWidget("nope")).toBeUndefined();
  });
});
