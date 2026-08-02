import { describe, expect, it } from "vitest";
import {
  DIMENSIONS,
  EMPTY_BUCKET,
  bucketByEdges,
  bucketsOf,
  customFieldDimensions,
  getDimension,
  resolveDimension,
  R_MULTIPLE_EDGES,
  tagSplitDimensions,
} from "./dimensions";
import { DAY, dimCtx, enrich, mkReport } from "./test-helpers";

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
      "Ponedeljak",
    ]);
    expect(bucketsOf(getDimension("dow_exit")!, t, dimCtx())).toEqual([
      "Petak",
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
      "1–3 (loše)",
    ]);
  });

  it("reads day grade from the CLOSE day — the outcome", () => {
    const t = one([held]);
    const ctx = dimCtx([
      mkReport("2026-01-05", { day_grade: "F" }),
      mkReport("2026-01-09", { day_grade: "A" }),
    ]);
    expect(bucketsOf(getDimension("day_grade")!, t, ctx)).toEqual(["A"]);
  });

  it("reads micromanage across the whole holding window", () => {
    // Interference happens mid-hold; neither endpoint would catch it.
    const t = one([held]);
    const ctx = dimCtx([mkReport("2026-01-07", { micromanage: "violated" })]);
    expect(bucketsOf(getDimension("micromanage")!, t, ctx)).toEqual([
      "violated",
    ]);
  });

  it("takes the worst micromanage state across the window", () => {
    const t = one([held]);
    const ctx = dimCtx([
      mkReport("2026-01-05", { micromanage: "untouched" }),
      mkReport("2026-01-07", { micromanage: "violated" }),
      mkReport("2026-01-09", { micromanage: "watched" }),
    ]);
    expect(bucketsOf(getDimension("micromanage")!, t, ctx)).toEqual([
      "violated",
    ]);
  });

  it("excludes a trade with no journal entry rather than inventing a bucket", () => {
    // Unrecorded process is unknown, not a value — bucketing it would make an
    // absence look like a finding.
    const t = one([held]);
    expect(bucketsOf(getDimension("micromanage")!, t, dimCtx())).toEqual([]);
    expect(bucketsOf(getDimension("mental_temp")!, t, dimCtx())).toEqual([]);
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
    expect(resolveDimension("psych_discipline", ctx)?.label).toBe("Disciplina");
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
