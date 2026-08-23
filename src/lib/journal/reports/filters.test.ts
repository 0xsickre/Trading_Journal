import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  applyFilters,
  fromSearchParams,
  isEmptyFilterSet,
  toSearchParams,
  type FilterSet,
} from "./filters";
import { DAY, dimCtx, enrich } from "./test-helpers";

const ids = (list: { id: string }[]) => list.map((t) => t.id);

const book = () =>
  enrich([
    { id: "a", instrument: "EURUSD", setupGrade: "A", r: 2, net: 200 },
    { id: "b", instrument: "EURUSD", setupGrade: "B", r: -1, net: -100 },
    { id: "c", instrument: "XAUUSD", setupGrade: "A", r: 0.5, net: 50 },
    { id: "d", instrument: "XAUUSD", setupGrade: undefined, r: 3, net: 300 },
  ]);

describe("in / notIn", () => {
  it("includes exactly what is listed", () => {
    const f: FilterSet = {
      clauses: [{ field: "instrument", op: "in", values: ["EURUSD"] }],
    };
    expect(ids(applyFilters(book(), f, dimCtx()))).toEqual(["a", "b"]);
  });

  it("excludes exactly what `in` would have included", () => {
    // The two must partition the book; that is the whole contract of negation.
    const all = book();
    const inc: FilterSet = {
      clauses: [{ field: "instrument", op: "in", values: ["EURUSD"] }],
    };
    const exc: FilterSet = {
      clauses: [{ field: "instrument", op: "notIn", values: ["EURUSD"] }],
    };
    const a = ids(applyFilters(all, inc, dimCtx()));
    const b = ids(applyFilters(all, exc, dimCtx()));
    expect([...a, ...b].sort()).toEqual(["a", "b", "c", "d"]);
    expect(a.filter((x) => b.includes(x))).toEqual([]);
  });

  it("keeps a trade with no value when negating", () => {
    // "not an A-setup" is true of a trade with no grade recorded at all.
    const f: FilterSet = {
      clauses: [{ field: "setup_grade", op: "notIn", values: ["A"] }],
    };
    expect(ids(applyFilters(book(), f, dimCtx()))).toEqual(["b", "d"]);
  });

  it("ANDs several clauses", () => {
    const f: FilterSet = {
      clauses: [
        { field: "instrument", op: "in", values: ["XAUUSD"] },
        { field: "setup_grade", op: "in", values: ["A"] },
      ],
    };
    expect(ids(applyFilters(book(), f, dimCtx()))).toEqual(["c"]);
  });
});

describe("between", () => {
  it("bounds a numeric field inclusively", () => {
    const f: FilterSet = {
      clauses: [{ field: "r", op: "between", min: 0.5, max: 2 }],
    };
    expect(ids(applyFilters(book(), f, dimCtx()))).toEqual(["a", "c"]);
  });

  it("accepts an open-ended bound", () => {
    const f: FilterSet = { clauses: [{ field: "r", op: "between", min: 2 }] };
    expect(ids(applyFilters(book(), f, dimCtx()))).toEqual(["a", "d"]);
  });

  it("drops trades with no value for the field", () => {
    const trades = enrich([
      { id: "known", durationSeconds: 5 * DAY },
      { id: "unknown", durationSeconds: null },
    ]);
    const f: FilterSet = {
      clauses: [{ field: "duration_days", op: "between", min: 1 }],
    };
    expect(ids(applyFilters(trades, f, dimCtx()))).toEqual(["known"]);
  });
});

describe("isSet / isNotSet", () => {
  it("splits on whether the dimension has a value", () => {
    const trades = enrich([
      { id: "tagged", technicalTags: ["FVG"] },
      { id: "bare", technicalTags: [] },
    ]);
    const set: FilterSet = {
      clauses: [{ field: "technical_tags", op: "isSet" }],
    };
    const unset: FilterSet = {
      clauses: [{ field: "technical_tags", op: "isNotSet" }],
    };
    expect(ids(applyFilters(trades, set, dimCtx()))).toEqual(["tagged"]);
    expect(ids(applyFilters(trades, unset, dimCtx()))).toEqual(["bare"]);
  });
});

describe("date and account scoping", () => {
  const trades = () =>
    enrich([
      { id: "jan", closedAt: "2026-01-15T10:00:00Z", accountId: "acc-1" },
      { id: "feb", closedAt: "2026-02-15T10:00:00Z", accountId: "acc-2" },
    ]);

  it("bounds by close date inclusively", () => {
    expect(
      ids(applyFilters(trades(), { clauses: [], dateFrom: "2026-02-01" }, dimCtx())),
    ).toEqual(["feb"]);
    expect(
      ids(applyFilters(trades(), { clauses: [], dateTo: "2026-01-15" }, dimCtx())),
    ).toEqual(["jan"]);
  });

  it("scopes by account", () => {
    expect(
      ids(applyFilters(trades(), { clauses: [], accountIds: ["acc-2"] }, dimCtx())),
    ).toEqual(["feb"]);
  });

  it("treats an empty account list as no constraint", () => {
    expect(
      ids(applyFilters(trades(), { clauses: [], accountIds: [] }, dimCtx())),
    ).toEqual(["jan", "feb"]);
  });
});

describe("URL round trip", () => {
  const roundTrip = (f: FilterSet) => fromSearchParams(toSearchParams(f));

  it("survives every clause shape", () => {
    const f: FilterSet = {
      clauses: [
        { field: "instrument", op: "in", values: ["EURUSD", "XAUUSD"] },
        { field: "setup_grade", op: "notIn", values: ["C"] },
        { field: "r", op: "between", min: -1, max: 3 },
        { field: "technical_tags", op: "isSet" },
        { field: "mistake", op: "isNotSet" },
      ],
      dateFrom: "2026-01-01",
      dateTo: "2026-03-31",
      accountIds: ["acc-1", "acc-2"],
    };
    expect(roundTrip(f)).toEqual(f);
  });

  it("survives bucket labels containing spaces and dashes", () => {
    // Real labels look like "2R … 3R" and "4–5 (ispod proseka)".
    const f: FilterSet = {
      clauses: [
        { field: "r_bucket", op: "in", values: ["2R … 3R", "-2R … -1R"] },
        { field: "mental_temp", op: "in", values: ["4–5 (ispod proseka)"] },
      ],
    };
    expect(roundTrip(f)).toEqual(f);
  });

  it("keeps an open-ended between open-ended", () => {
    const f: FilterSet = {
      clauses: [{ field: "r", op: "between", min: 1 }],
    };
    expect(roundTrip(f)).toEqual(f);
  });

  it("returns an empty set for empty params", () => {
    expect(fromSearchParams(new URLSearchParams())).toEqual({ clauses: [] });
  });

  it("ignores malformed clauses instead of throwing", () => {
    const p = new URLSearchParams();
    p.append("f", "garbage");
    p.append("f", "field:unknownOp:x");
    p.append("f", "instrument:in:EURUSD");
    expect(fromSearchParams(p).clauses).toEqual([
      { field: "instrument", op: "in", values: ["EURUSD"] },
    ]);
  });

  it("reads Next.js style searchParams records", () => {
    const parsed = fromSearchParams({
      f: ["instrument:in:EURUSD", "setup_grade:notIn:C"],
      from: "2026-01-01",
    });
    expect(parsed.clauses).toHaveLength(2);
    expect(parsed.dateFrom).toBe("2026-01-01");
  });
});

describe("helpers", () => {
  it("recognises an empty set", () => {
    expect(isEmptyFilterSet({ clauses: [] })).toBe(true);
    expect(isEmptyFilterSet({ clauses: [], dateFrom: "2026-01-01" })).toBe(false);
  });

  it("counts active constraints for a badge", () => {
    expect(
      activeFilterCount({
        clauses: [{ field: "instrument", op: "in", values: ["EURUSD"] }],
        dateFrom: "2026-01-01",
        accountIds: ["acc-1"],
      }),
    ).toBe(3);
  });
});

describe("date bounds use the account timezone, not UTC", () => {
  // 02:00Z on Jan 6 is still Jan 5 in New York. Every bucket in the engine is
  // keyed on the account-tz day (`closeDay`), so slicing the UTC date here put
  // a trade in the Jan-5 row of a table that a `to=2026-01-05` filter had just
  // excluded it from.
  const nyBook = () =>
    enrich(
      [
        { id: "late", closedAt: "2026-01-06T02:00:00Z" },
        { id: "midday", closedAt: "2026-01-05T17:00:00Z" },
      ],
      "America/New_York",
    );

  it("keeps a trade whose NY close day is inside the bound", () => {
    expect(nyBook().map((t) => t.closeDay)).toEqual(["2026-01-05", "2026-01-05"]);
    const f: FilterSet = { clauses: [], dateTo: "2026-01-05" };
    expect(ids(applyFilters(nyBook(), f, dimCtx())).sort()).toEqual([
      "late",
      "midday",
    ]);
  });

  it("excludes it from the following UTC day, which it never belonged to", () => {
    const f: FilterSet = { clauses: [], dateFrom: "2026-01-06" };
    expect(ids(applyFilters(nyBook(), f, dimCtx()))).toEqual([]);
  });

  it("agrees with the bucket the month dimension puts the trade in", () => {
    // Same instant, different month in each clock: 2026-02-01T02:00Z is January
    // in New York. The filter and the dimension must not disagree.
    const b = enrich(
      [{ id: "x", closedAt: "2026-02-01T02:00:00Z" }],
      "America/New_York",
    );
    expect(b[0].closeDay.slice(0, 7)).toBe("2026-01");
    const f: FilterSet = { clauses: [], dateFrom: "2026-01-01", dateTo: "2026-01-31" };
    expect(ids(applyFilters(b, f, dimCtx()))).toEqual(["x"]);
  });
});

describe("between reaches every numeric field, not just R", () => {
  // Each field in `NUMERIC_FIELDS` is its own accessor into a different corner
  // of the enriched trade — money, size, and the two excursion figures each
  // come from a different place. Only `r` and `duration_days` were exercised,
  // so an accessor wired to the wrong property would have filtered on the wrong
  // number with nothing to say so.
  const book = () =>
    enrich([
      { id: "a", net: 200, size: 1, mae: 95, mfe: 130 },
      { id: "b", net: -100, size: 5, mae: 80, mfe: 105 },
      { id: "c", net: 50, size: 10 },
    ]);

  const kept = (field: string, min?: number, max?: number) =>
    ids(applyFilters(book(), { clauses: [{ field, op: "between", min, max }] }, dimCtx()));

  it("filters on money", () => {
    expect(kept("pnl", 0)).toEqual(["a", "c"]);
    expect(kept("pnl", undefined, 0)).toEqual(["b"]);
  });

  it("filters on position size", () => {
    expect(kept("size", 2, 10)).toEqual(["b", "c"]);
  });

  it("filters on the excursion figures", () => {
    // `c` carries no chart prices at all, so it has no MAE and no MFE — and a
    // trade with no value must be dropped by a range filter rather than counted
    // as zero, which would put it inside almost any band.
    expect(kept("mae_r")).toEqual(["a", "b"]);
    expect(kept("mfe_r")).toEqual(["a", "b"]);
    expect(kept("mfe_r", 2)).toEqual(["a"]);
  });
});
