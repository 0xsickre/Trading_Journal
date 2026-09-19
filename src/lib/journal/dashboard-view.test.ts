import { describe, expect, it } from "vitest";
import { parseScope, periodStartKey } from "./dashboard-view";

describe("periodStartKey", () => {
  // Wednesday 8 April 2026.
  const TODAY = "2026-04-08";

  it("opens calendar periods on their calendar boundary", () => {
    expect(periodStartKey("week", TODAY)).toBe("2026-04-06");
    expect(periodStartKey("month", TODAY)).toBe("2026-04-01");
    expect(periodStartKey("ytd", TODAY)).toBe("2026-01-01");
  });

  it("treats Sunday as the end of the week, not the start of the next", () => {
    expect(periodStartKey("week", "2026-04-12")).toBe("2026-04-06");
    expect(periodStartKey("week", "2026-04-06")).toBe("2026-04-06");
  });

  it("counts rolling windows back from today, inclusive", () => {
    expect(periodStartKey("30", TODAY)).toBe("2026-03-10");
    expect(periodStartKey("90", TODAY)).toBe("2026-01-09");
  });

  it("has no start for all time or an unknown value", () => {
    expect(periodStartKey("all", TODAY)).toBeNull();
    expect(periodStartKey("bogus", TODAY)).toBeNull();
  });
});

describe("parseScope", () => {
  it("keeps valid fields only", () => {
    expect(
      parseScope(JSON.stringify({ account: "acc-1", period: "week", mode: "gross", viewMode: "r" })),
    ).toEqual({ account: "acc-1", period: "week", mode: "gross" });
  });

  it("returns nothing for missing or broken storage", () => {
    expect(parseScope(null)).toEqual({});
    expect(parseScope("{oops")).toEqual({});
    expect(parseScope(JSON.stringify({ period: "365" }))).toEqual({});
  });
});
