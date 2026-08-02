import { describe, expect, it } from "vitest";
import {
  DEFAULT_TZ,
  fmtInTz,
  parseImportTime,
  utcToZonedInput,
  zonedDateKey,
  zonedInputToUtc,
  zonedWeekStartKey,
} from "./time";

/**
 * The timezone half of `time.ts` had no test at all — 46% branch coverage on the
 * module where a mistake shifts every date in the app by a day, silently.
 *
 * Day-key ARITHMETIC (addDaysToDayKey, heatmapWindow, monthGridDays,
 * daysBetweenDayKeys, isoWeekdayOfDayKey) is covered in
 * `tracker/compliance.test.ts`, where it grew up. This file covers the
 * conversions: string in, zone applied, instant out.
 */

const NY = "America/New_York";
const BG = "Europe/Belgrade";

describe("parseImportTime — refuses to guess", () => {
  it("respects an explicit offset as an absolute instant", () => {
    expect(parseImportTime("2026-03-02T10:00:00Z", NY)).toBe(
      "2026-03-02T10:00:00.000Z",
    );
    expect(parseImportTime("2026-03-02T10:00:00+02:00", NY)).toBe(
      "2026-03-02T08:00:00.000Z",
    );
  });

  it("reads a year-first wall clock in the ACCOUNT's zone, not the server's", () => {
    // 10:00 in New York on 2 March 2026 is 15:00 UTC (EST, UTC−5).
    expect(parseImportTime("2026-03-02 10:00:00", NY)).toBe(
      "2026-03-02T15:00:00.000Z",
    );
    // The same wall clock in Belgrade (CET, UTC+1) is 09:00 UTC.
    expect(parseImportTime("2026-03-02 10:00:00", BG)).toBe(
      "2026-03-02T09:00:00.000Z",
    );
  });

  it("accepts the MT5 dotted form", () => {
    expect(parseImportTime("2026.03.02 10:00:00", NY)).toBe(
      "2026-03-02T15:00:00.000Z",
    );
  });

  it("takes a date-only value as midnight in the account's zone", () => {
    expect(parseImportTime("2026-03-02", NY)).toBe("2026-03-02T05:00:00.000Z");
  });

  it("REFUSES an all-numeric date that does not start with the year", () => {
    // The regression this whole function was rewritten for. `new Date` reads
    // these as US month-first, so a European export meaning 2 March came back
    // as 3 February — and only in the ambiguous window, because day > 12 was
    // Invalid Date and failed loudly. Refusing is the only honest answer: the
    // string genuinely does not say which number is the month.
    for (const s of [
      "02/03/2026",
      "02/03/2026 10:00",
      "02-03-2026",
      "2.3.2026",
      "25/03/2026",
    ]) {
      expect(parseImportTime(s, NY)).toBeNull();
    }
  });

  it("still accepts a month NAME, and applies the account's zone to it", () => {
    // Unambiguous, so it is kept — but the wall clock is re-applied in `tz`
    // rather than left in whatever zone the server happens to run in.
    expect(parseImportTime("Mar 2, 2026 10:00", NY)).toBe(
      "2026-03-02T15:00:00.000Z",
    );
    expect(parseImportTime("Mar 2, 2026 10:00", BG)).toBe(
      "2026-03-02T09:00:00.000Z",
    );
  });

  it("answers null for empty and unreadable input", () => {
    for (const s of [null, undefined, "", "   ", "not a date", "??"]) {
      expect(parseImportTime(s, NY)).toBeNull();
    }
  });
});

describe("an unknown timezone degrades instead of throwing", () => {
  // `Intl` throws RangeError on a name it does not know. Inside a Server
  // Component that is a 500 on every page showing a date — including Settings,
  // which is where the bad value would have to be corrected.
  const BAD = "Europe/Belgrad"; // one letter short of real

  it("keeps formatting rather than locking the user out", () => {
    expect(() => fmtInTz("2026-03-02T15:00:00Z", BAD)).not.toThrow();
    expect(fmtInTz("2026-03-02T15:00:00Z", BAD)).toBe(
      fmtInTz("2026-03-02T15:00:00Z", DEFAULT_TZ),
    );
  });

  it("keeps day keys resolvable, since every daily total joins on them", () => {
    expect(() => zonedDateKey("2026-03-02T15:00:00Z", BAD)).not.toThrow();
    expect(zonedDateKey("2026-03-02T15:00:00Z", BAD)).toBe("2026-03-02");
    expect(() => zonedWeekStartKey("2026-03-02T15:00:00Z", BAD)).not.toThrow();
  });

  it("does not fall back for a zone that IS real", () => {
    // The guard must not quietly flatten every account onto New York.
    expect(zonedDateKey("2026-03-02T04:00:00Z", BG)).toBe("2026-03-02");
    expect(zonedDateKey("2026-03-02T04:00:00Z", NY)).toBe("2026-03-01");
  });
});

describe("an unparseable instant renders, it does not throw", () => {
  it("shows an em dash where a timestamp was expected", () => {
    expect(fmtInTz("garbage", NY)).toBe("—");
  });

  it("gives a datetime-local input an empty value, not an em dash", () => {
    // The control cannot parse "—"; an empty string is the only value that
    // leaves the field usable.
    expect(utcToZonedInput("garbage", NY)).toBe("");
    expect(utcToZonedInput(null, NY)).toBe("");
  });

  it("keeps day keys empty rather than throwing", () => {
    expect(zonedDateKey("garbage", NY)).toBe("");
    expect(zonedWeekStartKey("garbage", NY)).toBe("");
  });
});

describe("round trip through the form", () => {
  it("returns the same wall clock it was given", () => {
    const utc = zonedInputToUtc("2026-03-02T09:30", NY);
    expect(utc).toBe("2026-03-02T14:30:00.000Z");
    expect(utcToZonedInput(utc, NY)).toBe("2026-03-02T09:30");
  });

  it("crosses a DST boundary without drifting", () => {
    // US DST began 8 March 2026. 09:30 the day before is EST (−5), the day
    // after is EDT (−4); a round trip must still give back 09:30 on both.
    for (const day of ["2026-03-07", "2026-03-09"]) {
      const utc = zonedInputToUtc(`${day}T09:30`, NY);
      expect(utcToZonedInput(utc, NY)).toBe(`${day}T09:30`);
    }
  });

  it("answers null for empty input", () => {
    expect(zonedInputToUtc("", NY)).toBeNull();
  });
});

describe("zonedWeekStartKey", () => {
  it("gives the Monday of the containing ISO week", () => {
    // 2026-03-02 is itself a Monday; 03-08 is the Sunday that ends that week.
    expect(zonedWeekStartKey("2026-03-02T15:00:00Z", NY)).toBe("2026-03-02");
    expect(zonedWeekStartKey("2026-03-08T15:00:00Z", NY)).toBe("2026-03-02");
    expect(zonedWeekStartKey("2026-03-09T15:00:00Z", NY)).toBe("2026-03-09");
  });

  it("walks back into the previous month when the week straddles it", () => {
    // 1 March 2026 is a Sunday, so its ISO week starts on 23 February.
    expect(zonedWeekStartKey("2026-03-01T15:00:00Z", NY)).toBe("2026-02-23");
  });

  it("uses the account's zone to decide which week a trade fell in", () => {
    // 02:00 UTC on Monday is still Sunday evening in New York — the previous
    // ISO week. This is the attribution bug the whole zone discipline exists for.
    expect(zonedWeekStartKey("2026-03-09T02:00:00Z", NY)).toBe("2026-03-02");
    expect(zonedWeekStartKey("2026-03-09T02:00:00Z", BG)).toBe("2026-03-09");
  });
});
