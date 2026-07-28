import { describe, expect, it } from "vitest";
import { formatDuration } from "./units";

describe("formatDuration", () => {
  it("scales from seconds to days", () => {
    expect(formatDuration(30)).toBe("30s");
    expect(formatDuration(45 * 60)).toBe("45m");
    expect(formatDuration(5 * 3600 + 20 * 60)).toBe("5h 20m");
    expect(formatDuration(3 * 86400 + 4 * 3600)).toBe("3d 4h");
    expect(formatDuration(3 * 86400)).toBe("3d");
  });

  it("drops trailing minutes once the hold is measured in days", () => {
    // A swing hold is read in days; the odd 59 minutes is noise.
    expect(formatDuration(3 * 86400 + 4 * 3600 + 59 * 60)).toBe("3d 4h");
  });

  it("shows whole hours without a minutes part", () => {
    expect(formatDuration(5 * 3600)).toBe("5h");
  });

  it("returns an em dash for missing or negative input", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(undefined)).toBe("—");
    expect(formatDuration(Number.NaN)).toBe("—");
    expect(formatDuration(-5)).toBe("—");
  });
});
