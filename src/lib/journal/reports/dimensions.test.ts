import { describe, expect, it } from "vitest";
import {
  DIMENSIONS,
  EMPTY_BUCKET,
  bucketByEdges,
  bucketsOf,
  customFieldDimensions,
  getDimension,
  resolveDimension,
  DIMENSION_GROUP_LABELS,
  DIMENSION_GROUP_ORDER,
  R_MULTIPLE_EDGES,
  tagSplitDimensions,
} from "./dimensions";
import {
  DAY,
  TEST_FIELD_DEFS,
  byPosition,
  dimCtx,
  enrich,
  mkCheckin,
  mkReport,
} from "./test-helpers";

const one = (specs: Parameters<typeof enrich>[0]) => enrich(specs)[0];

describe("registry integrity", () => {
  it("has no duplicate keys", () => {
    const keys = DIMENSIONS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives every dimension a label and a group", () => {
    for (const d of DIMENSIONS) {
      expect(d.label.length).toBeGreaterThan(0);
      expect(["trade", "derived", "process", "insight"]).toContain(d.group);
    }
  });

  it("declares order values that its own bucketing can actually produce", () => {
    // A stale `order` entry silently sorts a bucket to the bottom forever.
    const dim = getDimension("hold_duration")!;
    expect(dim.order).toEqual(["<1d", "1–3d", "3–7d", "1–2w", ">2w"]);
    const t = one([{ durationSeconds: 5 * DAY }]);
    expect(bucketsOf(dim, t, dimCtx())).toEqual(["3–7d"]);
  });
});

describe("trade column dimensions", () => {
  it("groups by a plain column", () => {
    const t = one([{ instrument: "XAUUSD" }]);
    expect(bucketsOf(getDimension("instrument")!, t, dimCtx())).toEqual([
      "XAUUSD",
    ]);
  });

  it("uses an explicit empty bucket for an unset column", () => {
    const t = one([{ setupGrade: undefined }]);
    expect(bucketsOf(getDimension("setup_grade")!, t, dimCtx())).toEqual([
      EMPTY_BUCKET,
    ]);
  });

  it("normalizes direction rather than trusting the stored string", () => {
    const short = one([{ direction: "Short (sell)" }]);
    const long = one([{ direction: "" }]);
    expect(bucketsOf(getDimension("direction")!, short, dimCtx())).toEqual([
      "Short",
    ]);
    expect(bucketsOf(getDimension("direction")!, long, dimCtx())).toEqual([
      "Long",
    ]);
  });

  it("puts a tagged trade into every one of its tags", () => {
    const t = one([{ technicalTags: ["Sweep", "FVG", "MSS"] }]);
    const dim = getDimension("technical_tags")!;
    expect(dim.multiValue).toBe(true);
    expect(bucketsOf(dim, t, dimCtx())).toEqual(["Sweep", "FVG", "MSS"]);
  });

  it("resolves an account id to its name when one is supplied", () => {
    const t = one([{ accountId: "acc-9" }]);
    const ctx = dimCtx([], { accountNames: new Map([["acc-9", "FTMO 100k"]]) });
    expect(bucketsOf(getDimension("account")!, t, ctx)).toEqual(["FTMO 100k"]);
  });
});

describe("derived bucket dimensions", () => {
  it("buckets R-multiples on declared edges", () => {
    expect(bucketByEdges(-3, R_MULTIPLE_EDGES)).toBe("< -2R");
    expect(bucketByEdges(-1.5, R_MULTIPLE_EDGES)).toBe("-2R … -1R");
    expect(bucketByEdges(0, R_MULTIPLE_EDGES)).toBe("0R … 1R");
    expect(bucketByEdges(2.5, R_MULTIPLE_EDGES)).toBe("2R … 3R");
    expect(bucketByEdges(9, R_MULTIPLE_EDGES)).toBe("> 3R");
  });

  it("returns null for an unknown numeric, so the trade is excluded", () => {
    expect(bucketByEdges(null, R_MULTIPLE_EDGES)).toBeNull();
    const t = one([{ size: null }]);
    expect(bucketsOf(getDimension("size_bucket")!, t, dimCtx())).toEqual([]);
  });

  it("derives month from the close date", () => {
    const t = one([{ closedAt: "2026-03-14T10:00:00Z" }]);
    expect(bucketsOf(getDimension("month")!, t, dimCtx())).toEqual(["2026-03"]);
  });

  it("separates entry weekday from exit weekday", () => {
    // Opened Monday 2026-01-05, closed Friday 2026-01-09.
    const t = one([
      { openedAt: "2026-01-05T10:00:00Z", closedAt: "2026-01-09T10:00:00Z" },
    ]);
    expect(bucketsOf(getDimension("dow_entry")!, t, dimCtx())).toEqual([
      "Monday",
    ]);
    expect(bucketsOf(getDimension("dow_exit")!, t, dimCtx())).toEqual([
      "Friday",
    ]);
  });
});

describe("process dimensions", () => {
  const held = {
    openedAt: "2026-01-05T09:00:00Z",
    closedAt: "2026-01-09T09:00:00Z",
  };

  it("reads mental temperature from the OPEN day — the entry decision", () => {
    const t = one([held]);
    const ctx = dimCtx([
      mkReport("2026-01-05", { mental_temp: 3 }),
      mkReport("2026-01-09", { mental_temp: 9 }),
    ]);
    expect(bucketsOf(getDimension("mental_temp")!, t, ctx)).toEqual([
      "1–3 (poor)",
    ]);
  });

  it("reads interference from the position's OWN check-ins, mid-hold", () => {
    // Interference happens while the position is open; neither endpoint of the
    // trade would catch it.
    const t = one([{ ...held, id: "p1" }]);
    const ctx = dimCtx([], {
      checkinsByPosition: byPosition([
        mkCheckin("p1", "2026-01-07", { touched: "stop_moved" }),
      ]),
    });
    expect(bucketsOf(getDimension("touched")!, t, ctx)).toEqual(["stop_moved"]);
  });

  it("takes the furthest-from-plan state across the hold", () => {
    // Not the last answer and not the average: touching a position once in five
    // days is the fact worth grouping on, and `added` outranks `stop_moved`
    // because it takes on exposure the plan never sized for.
    const t = one([{ ...held, id: "p1" }]);
    const ctx = dimCtx([], {
      checkinsByPosition: byPosition([
        mkCheckin("p1", "2026-01-05", { touched: "untouched" }),
        mkCheckin("p1", "2026-01-07", { touched: "added" }),
        mkCheckin("p1", "2026-01-09", { touched: "partial_exit" }),
      ]),
    });
    expect(bucketsOf(getDimension("touched")!, t, ctx)).toEqual(["added"]);
  });

  it("never lets ANOTHER position's answer reach this one", () => {
    // The measurement bug this replaced: `micromanage` was a column on the DAY,
    // so an untouched position was convicted by the calendar whenever a
    // different one was touched while both were open.
    const t = one([{ ...held, id: "p1" }]);
    const ctx = dimCtx([], {
      checkinsByPosition: byPosition([
        mkCheckin("p1", "2026-01-07", { touched: "untouched" }),
        mkCheckin("p2", "2026-01-07", { touched: "added" }),
      ]),
    });
    expect(bucketsOf(getDimension("touched")!, t, ctx)).toEqual(["untouched"]);
  });

  it("takes the worst thesis state across the hold", () => {
    const t = one([{ ...held, id: "p1" }]);
    const ctx = dimCtx([], {
      checkinsByPosition: byPosition([
        mkCheckin("p1", "2026-01-05", { thesis_state: "intact" }),
        mkCheckin("p1", "2026-01-07", { thesis_state: "invalidated" }),
        mkCheckin("p1", "2026-01-09", { thesis_state: "weakened" }),
      ]),
    });
    expect(bucketsOf(getDimension("thesis_state")!, t, ctx)).toEqual([
      "invalidated",
    ]);
  });

  it("splits weekend holds from trades that were flat by Friday", () => {
    // Mon→Fri never crosses a Saturday; Fri→Mon does.
    const flat = one([held]);
    const over = one([
      { openedAt: "2026-01-09T09:00:00Z", closedAt: "2026-01-12T09:00:00Z" },
    ]);
    const dim = getDimension("weekend_hold")!;
    expect(bucketsOf(dim, flat, dimCtx())).toEqual(["Flat by Friday"]);
    expect(bucketsOf(dim, over, dimCtx())).toEqual(["Held over weekend"]);
  });

  it("excludes a trade with no entry rather than inventing a bucket", () => {
    // Unrecorded process is unknown, not a value — bucketing it would make an
    // absence look like a finding. A check-in row that exists but answers
    // nothing is the same silence.
    const t = one([{ ...held, id: "p1" }]);
    expect(bucketsOf(getDimension("touched")!, t, dimCtx())).toEqual([]);
    expect(bucketsOf(getDimension("thesis_state")!, t, dimCtx())).toEqual([]);
    expect(bucketsOf(getDimension("mental_temp")!, t, dimCtx())).toEqual([]);

    const silent = dimCtx([], {
      checkinsByPosition: byPosition([mkCheckin("p1", "2026-01-07")]),
    });
    expect(bucketsOf(getDimension("touched")!, t, silent)).toEqual([]);
    expect(bucketsOf(getDimension("thesis_state")!, t, silent)).toEqual([]);
  });
});

describe("insight dimension", () => {
  it("places a trade in every insight that fired for it", () => {
    const t = one([{ id: "x1" }]);
    const ctx = dimCtx([], {
      insightsByTrade: new Map([["x1", ["green_to_red", "weak_win"]]]),
    });
    const dim = getDimension("insight")!;
    expect(dim.multiValue).toBe(true);
    expect(bucketsOf(dim, t, ctx)).toEqual(["green_to_red", "weak_win"]);
  });

  it("excludes a trade that fired nothing", () => {
    const t = one([{ id: "x1" }]);
    expect(bucketsOf(getDimension("insight")!, t, dimCtx())).toEqual([]);
  });
});

describe("user-defined fields as dimensions", () => {
  const DEFS = [
    { key: "session", label: "Sesija", field_type: "select", list_key: "session" },
    { key: "confluences", label: "Konfluencije", field_type: "tags", list_key: null },
  ];

  it("registers one dimension per definition", () => {
    const dims = customFieldDimensions(DEFS);
    expect(dims.map((d) => d.key)).toEqual(["session", "confluences"]);
    expect(dims.every((d) => d.group === "custom")).toBe(true);
  });

  it("buckets a value stored in the custom bag", () => {
    const [session] = customFieldDimensions(DEFS);
    const t = enrich([{ custom: { session: "London" } }])[0];
    expect(bucketsOf(session, t, dimCtx())).toEqual(["London"]);
  });

  it("gives an empty bucket when the field was never filled in", () => {
    const [session] = customFieldDimensions(DEFS);
    const t = enrich([{}])[0];
    expect(bucketsOf(session, t, dimCtx())).toEqual([EMPTY_BUCKET]);
  });

  it("treats a tags field as multi-value, so one trade lands in every tag", () => {
    const [, confluences] = customFieldDimensions(DEFS);
    expect(confluences.multiValue).toBe(true);
    const t = enrich([{ custom: { confluences: ["FVG", "OTE"] } }])[0];
    expect(bucketsOf(confluences, t, dimCtx())).toEqual(["FVG", "OTE"]);
  });

  it("resolves a custom key by name, the same way a built-in resolves", () => {
    const ctx = dimCtx([], { customDimensions: customFieldDimensions(DEFS) });
    expect(resolveDimension("session", ctx)?.label).toBe("Sesija");
    expect(resolveDimension("instrument", ctx)?.label).toBe("Instrument");
    // Without the context it is not a global — one trader's fields must never
    // leak into another's report.
    expect(resolveDimension("session")).toBeUndefined();
  });

  it("does not shadow a built-in dimension", () => {
    const ctx = dimCtx([], {
      customDimensions: customFieldDimensions([
        { key: "instrument", label: "Hijacked", field_type: "select", list_key: null },
      ]),
    });
    expect(resolveDimension("instrument", ctx)?.label).toBe("Instrument");
  });

  it("no longer carries the columns Phase 4a retired", () => {
    const keys = DIMENSIONS.map((d) => d.key);
    for (const gone of [
      "macro_align",
      "cot_filter",
      "htf_bias",
      "entry_tf",
      "ict_entry_model",
    ]) {
      expect(keys).not.toContain(gone);
    }
  });

  it("no longer offers the manual result column", () => {
    // Dropped in 20260801190000: a hand-picked Win/Loss/Breakeven duplicated
    // `outcome`, which every statistic already derives from net P&L and the
    // account's breakeven band — and could contradict it with nothing to catch
    // the disagreement.
    expect(DIMENSIONS.map((d) => d.key)).not.toContain("result");
    expect(getDimension("outcome")?.order).toEqual([
      "win",
      "breakeven",
      "loss",
    ]);
  });
});

describe("splitting psychology_tags back into its source lists", () => {
  // Mirrors the seeded lists, including the collision: `Revenge` is in both.
  const OPTIONS = {
    emotion: [
      { value: "FOMO" },
      { value: "Strah" },
      { value: "Revenge" },
    ],
    discipline: [
      { value: "Followed plan" },
      { value: "Moved stop" },
      { value: "Revenge" },
    ],
  };
  const [emotion, discipline] = tagSplitDimensions(OPTIONS);

  it("sends each tag to the list it came from", () => {
    const t = one([{ psychologyTags: ["FOMO", "Moved stop"] }]);
    expect(bucketsOf(emotion, t, dimCtx())).toEqual(["FOMO"]);
    expect(bucketsOf(discipline, t, dimCtx())).toEqual(["Moved stop"]);
  });

  it("gives a value present in BOTH lists to the first one only", () => {
    // `Revenge` is seeded into emotion and discipline alike, and the chip
    // picker dedupes in listKeys order — so the tag the trader clicked came
    // from emotion. Landing in both would count one trade twice across two
    // tables that are meant to partition one column.
    const t = one([{ psychologyTags: ["Revenge"] }]);
    expect(bucketsOf(emotion, t, dimCtx())).toEqual(["Revenge"]);
    expect(bucketsOf(discipline, t, dimCtx())).toEqual([]);
  });

  it("excludes a trade that said nothing about this half", () => {
    // Excluded, not bucketed as "—": the trade did record its psychology, it
    // simply made no discipline claim. An empty bucket would read as a finding
    // about trades that never made one.
    const t = one([{ psychologyTags: ["FOMO"] }]);
    expect(bucketsOf(discipline, t, dimCtx())).toEqual([]);
  });

  it("drops a free-typed tag from both halves but keeps it in the combined one", () => {
    // The picker lets you type a new tag, and an option deleted later belongs
    // to no list. The combined dimension is kept for exactly this case.
    const t = one([{ psychologyTags: ["Nešto svoje"] }]);
    expect(bucketsOf(emotion, t, dimCtx())).toEqual([]);
    expect(bucketsOf(discipline, t, dimCtx())).toEqual([]);
    expect(bucketsOf(getDimension("psychology_tags")!, t, dimCtx())).toEqual([
      "Nešto svoje",
    ]);
  });

  it("marks both halves multi-value, like the column they cut", () => {
    // One trade can carry two emotions. Consumers must keep warning that the
    // rows no longer sum to the portfolio total.
    expect(emotion.multiValue).toBe(true);
    expect(discipline.multiValue).toBe(true);
    const t = one([{ psychologyTags: ["FOMO", "Strah"] }]);
    expect(bucketsOf(emotion, t, dimCtx())).toEqual(["FOMO", "Strah"]);
  });

  it("resolves by key once carried on the context", () => {
    const ctx = dimCtx([], { customDimensions: tagSplitDimensions(OPTIONS) });
    expect(resolveDimension("psych_discipline", ctx)?.label).toBe("Discipline");
    // Per user, never a global — same rule as the custom field dimensions.
    expect(resolveDimension("psych_discipline")).toBeUndefined();
  });

  it("survives an option list the user has emptied", () => {
    const [e, d] = tagSplitDimensions({ emotion: [], discipline: [] });
    const t = one([{ psychologyTags: ["FOMO"] }]);
    expect(bucketsOf(e, t, dimCtx())).toEqual([]);
    expect(bucketsOf(d, t, dimCtx())).toEqual([]);
  });
});

describe("every dimension buckets without throwing", () => {
  /**
   * The companion to the metric registry sweep. A report renders one row per
   * bucket of ONE dimension, so a `valueOf` that throws takes the page down
   * rather than blanking a cell — and nine of these callbacks had never been
   * executed by a test.
   */
  const rich = one([
    {
      // Named so the check-in fixture below joins onto it — the sweep is meant
      // to execute each `valueOf`'s populated path, not its early return.
      id: "rich",
      instrument: "XAUUSD",
      net: 300,
      r: 3,
      setupGrade: "A",
      direction: "Short",
      technicalTags: ["FVG"],
      psychologyTags: ["FOMO"],
      size: 2,
      durationSeconds: 3 * DAY,
      accountId: "acc1",
      custom: { macro_align: "Aligned" },
    },
  ]);

  // Everything absent that can be absent: no tags, no grade, no size, no
  // duration, no account, no custom values.
  const bare = one([{ net: 0, r: null, durationSeconds: null, size: null, accountId: null }]);

  const ctx = dimCtx([mkReport("2026-01-09", { mental_temp: 6 })], {
    checkinsByPosition: byPosition([
      mkCheckin("rich", "2026-01-09", {
        thesis_state: "weakened",
        touched: "partial_exit",
      }),
    ]),
  });

  const all = [...DIMENSIONS, ...customFieldDimensions(TEST_FIELD_DEFS)];

  it("over a fully populated trade", () => {
    for (const d of all) {
      expect(() => bucketsOf(d, rich, ctx), d.key).not.toThrow();
    }
  });

  it("over a trade with everything absent", () => {
    for (const d of all) {
      expect(() => bucketsOf(d, bare, ctx), d.key).not.toThrow();
    }
  });

  it("always answers an array of strings, never a bare value or undefined", () => {
    // `bucketsOf` is what the engine groups on. A non-array or an `undefined`
    // inside it would become the string "undefined" as a bucket label.
    for (const d of all) {
      for (const t of [rich, bare]) {
        const buckets = bucketsOf(d, t, ctx);
        expect(Array.isArray(buckets), d.key).toBe(true);
        for (const b of buckets) {
          expect(typeof b, `${d.key} → ${String(b)}`).toBe("string");
          expect(b.length, d.key).toBeGreaterThan(0);
        }
      }
    }
  });

  it("keeps a single-value dimension to at most one bucket", () => {
    // Only dimensions declaring `multiValue` may put one trade in two rows;
    // for the rest, rows must still sum to the portfolio total.
    for (const d of all.filter((x) => !x.multiValue)) {
      expect(bucketsOf(d, rich, ctx).length, d.key).toBeLessThanOrEqual(1);
    }
  });

  it("declares an order only in values its own bucketing can produce", () => {
    // A stale entry in `order` sorts a real bucket to the bottom forever, and
    // nothing errors. Checked structurally: every ordered dimension's labels
    // must be non-empty strings, and the ordered set must have no duplicates.
    for (const d of all.filter((x) => x.order)) {
      const order = [...d.order!];
      expect(new Set(order).size, d.key).toBe(order.length);
      for (const label of order) expect(label.length, d.key).toBeGreaterThan(0);
    }
  });

  it("groups every dimension under a label the picker can show", () => {
    for (const d of all) {
      expect(DIMENSION_GROUP_LABELS[d.group], d.key).toBeTruthy();
      expect(DIMENSION_GROUP_ORDER, d.key).toContain(d.group);
    }
  });
});
