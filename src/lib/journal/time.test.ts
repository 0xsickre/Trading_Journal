import { describe, expect, it } from "vitest";
import {
  DEFAULT_TZ,
  fmtInTz,
  parseImportTime,
  utcToZonedInput,
  zonedDateKey,
  zonedInputToUtc,
  zonedWeekStartKey,
  isValidTimeZone,
  dayKeyStartUtc,
  isValidDayKey,
  isValidMonthKey,
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

describe("isValidTimeZone", () => {
  it("accepts the zones an account can actually be set to", () => {
    for (const tz of [
      "America/New_York",
      "Europe/Belgrade",
      "Europe/London",
      "Asia/Tokyo",
      "UTC",
    ]) {
      expect(isValidTimeZone(tz), tz).toBe(true);
    }
  });

  it("rejects the typo the read path would have swallowed", () => {
    // `safeTz` degrades an unknown zone to the default rather than throwing,
    // which is right for rendering and hides the mistake completely: save
    // `Europe/Belgrad` and every day key, calendar cell and daily total
    // silently resolves in New York. This is the function that lets the WRITE
    // refuse what the read would paper over.
    expect(isValidTimeZone("Europe/Belgrad")).toBe(false);
    expect(isValidTimeZone("America/New York")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isValidTimeZone("GMT+2")).toBe(false);
  });

  it("stays correct when asked twice, since the answer is memoized", () => {
    // `safeTz` caches by string. A cache that stored the FALLBACK under the bad
    // key would answer true the second time.
    expect(isValidTimeZone("Europe/Belgrad")).toBe(false);
    expect(isValidTimeZone("Europe/Belgrad")).toBe(false);
    expect(isValidTimeZone("Europe/Belgrade")).toBe(true);
    expect(isValidTimeZone("Europe/Belgrade")).toBe(true);
  });
});

describe("dayKeyStartUtc", () => {
  it("returns the instant midnight happens in that zone, not in UTC", () => {
    // 4 May 2026 is EDT (UTC-4), so the NY day opens at 04:00Z.
    expect(dayKeyStartUtc("2026-05-04", "America/New_York")).toBe(
      Date.parse("2026-05-04T04:00:00Z"),
    );
    // Belgrade is UTC+2 in May, so its day opened two hours BEFORE UTC's.
    expect(dayKeyStartUtc("2026-05-04", "Europe/Belgrade")).toBe(
      Date.parse("2026-05-03T22:00:00Z"),
    );
    expect(dayKeyStartUtc("2026-05-04", "UTC")).toBe(
      Date.parse("2026-05-04T00:00:00Z"),
    );
  });

  it("follows the zone across its DST change", () => {
    // 2026: US DST starts 8 March. The day before opens at 05:00Z (EST), the
    // day after at 04:00Z (EDT). A fixed offset would get one of them wrong.
    expect(dayKeyStartUtc("2026-03-07", "America/New_York")).toBe(
      Date.parse("2026-03-07T05:00:00Z"),
    );
    expect(dayKeyStartUtc("2026-03-09", "America/New_York")).toBe(
      Date.parse("2026-03-09T04:00:00Z"),
    );
  });

  it("round-trips with zonedDateKey, which is its inverse", () => {
    for (const tz of ["America/New_York", "Europe/Belgrade", "Asia/Tokyo"]) {
      for (const day of ["2026-01-01", "2026-03-09", "2026-07-04", "2026-12-31"]) {
        const ms = dayKeyStartUtc(day, tz)!;
        expect(zonedDateKey(new Date(ms).toISOString(), tz), `${tz} ${day}`).toBe(day);
      }
    }
  });

  it("is a BOUNDARY, which is the whole reason it exists", () => {
    // The defect it replaces: `new Date()` minus N days keeps the current time
    // of day, so the window slid all day long. Two calls for the same day must
    // give the identical instant no matter when they are made.
    expect(dayKeyStartUtc("2026-05-04", "America/New_York")).toBe(
      dayKeyStartUtc("2026-05-04", "America/New_York"),
    );
    const ms = dayKeyStartUtc("2026-05-04", "America/New_York")!;
    expect(new Date(ms).toISOString().endsWith(":00:00.000Z")).toBe(true);
  });

  it("answers null rather than NaN for a day key it cannot read", () => {
    // NaN would compare false against every timestamp and silently empty the
    // period window — showing an account with trades as having none.
    expect(dayKeyStartUtc("")).toBeNull();
    expect(dayKeyStartUtc("not-a-day")).toBeNull();
  });

  it("falls back to the default zone for an unknown one, like the rest of the module", () => {
    expect(dayKeyStartUtc("2026-05-04", "Europe/Belgrad")).toBe(
      dayKeyStartUtc("2026-05-04", DEFAULT_TZ),
    );
  });
});

describe("day and month keys out of a URL", () => {
  it("accepts real days, including a leap one", () => {
    for (const d of ["2026-01-01", "2026-05-04", "2026-12-31", "2028-02-29"]) {
      expect(isValidDayKey(d), d).toBe(true);
    }
  });

  it("REJECTS what the shape regex let through", () => {
    // Each of these matches /^\d{4}-\d{2}-\d{2}$/ and none of them is a day.
    // `2026-00-00` was the live one: it rolled backwards into December 2025, so
    // /calendar rendered December's grid under a 2026 heading and /daily opened
    // a date that does not exist — silently, in both cases.
    for (const d of [
      "2026-00-00",
      "2026-13-01",
      "2026-05-00",
      "2026-05-32",
      "2026-02-30",
      "2026-02-29", // 2026 is not a leap year
      "2026-04-31",
      "2026-99-99",
    ]) {
      expect(isValidDayKey(d), d).toBe(false);
    }
  });

  it("rejects the wrong shape outright", () => {
    for (const d of ["", "2026-5-4", "26-05-04", "2026/05/04", "2026-05-04T00:00", "abc"]) {
      expect(isValidDayKey(d), d).toBe(false);
    }
  });

  it("validates a month by its first day", () => {
    expect(isValidMonthKey("2026-01")).toBe(true);
    expect(isValidMonthKey("2026-12")).toBe(true);
    expect(isValidMonthKey("2026-00")).toBe(false);
    expect(isValidMonthKey("2026-13")).toBe(false);
    expect(isValidMonthKey("2026-1")).toBe(false);
    expect(isValidMonthKey("2026-05-04")).toBe(false);
  });
});

describe("parseImportTime — a bare number is not a date", () => {
  it("refuses an Excel serial or a timestamp that arrived as text", () => {
    expect(parseImportTime("45000", "America/New_York")).toBeNull();
    expect(parseImportTime("45000.5", "America/New_York")).toBeNull();
    expect(parseImportTime("1714060800", "America/New_York")).toBeNull();
  });

  it("still reads a dotted date, which is not a bare number", () => {
    expect(parseImportTime("2026.03.05 14:30:00", "UTC")).toBe("2026-03-05T14:30:00.000Z");
  });
});
