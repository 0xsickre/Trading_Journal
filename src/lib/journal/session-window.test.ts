import { describe, expect, it } from "vitest";
import {
  afterSessionOpen,
  minutesAfterOpen,
  OPEN_OFFSET_BUCKETS,
  openOffsetBucket,
  sessionWindowOf,
  SESSION_WINDOWS,
  SESSIONS,
} from "./session-window";

// 13.10.2026: both clocks on summer time. Belgrade = UTC+2, London = UTC+1, New York = UTC−4.
const oct13 = (hhmmBelgrade: string) => {
  const [h, m] = hhmmBelgrade.split(":").map(Number);
  return new Date(Date.UTC(2026, 9, 13, h - 2, m)).toISOString();
};
// 27.10.2026: Europe already on winter time (Belgrade UTC+1, London UTC+0), New York still UTC−4.
const oct27 = (hhmmUtc: string) => `2026-10-27T${hhmmUtc}:00Z`;
// 15.12.2026: both on winter time. Belgrade UTC+1, London UTC+0, New York UTC−5.
const dec15 = (hhmmBelgrade: string) => {
  const [h, m] = hhmmBelgrade.split(":").map(Number);
  return new Date(Date.UTC(2026, 11, 15, h - 1, m)).toISOString();
};

describe("sessions as on the chart, each on its exchange's clock (phase N)", () => {
  it("13.10.2026: both trades are London", () => {
    expect(sessionWindowOf("2026-10-13T07:24:39Z")).toBe(SESSIONS.london); // 09:24 Belgrade
    expect(sessionWindowOf("2026-10-13T07:44:32Z")).toBe(SESSIONS.london); // 09:44 Belgrade
  });

  it("every boundary in Belgrade time, on a usual day", () => {
    const cases: [string, string][] = [
      ["00:00", SESSIONS.asia],
      ["05:59", SESSIONS.asia],
      ["06:00", SESSIONS.preLondon],
      ["08:59", SESSIONS.preLondon],
      ["09:00", SESSIONS.london],
      ["13:59", SESSIONS.london],
      ["14:00", SESSIONS.nyPreOpen],
      ["15:29", SESSIONS.nyPreOpen],
      ["15:30", SESSIONS.nyAm],
      ["17:29", SESSIONS.nyAm],
      ["17:30", SESSIONS.lunch],
      ["19:30", SESSIONS.nyPm],
      ["21:59", SESSIONS.nyPm],
      ["22:00", SESSIONS.afterClose],
      ["23:59", SESSIONS.afterClose],
    ];
    for (const [t, want] of cases) expect(sessionWindowOf(oct13(t)), t).toBe(want);
  });

  it("the same Belgrade hours in winter, when both clocks moved", () => {
    expect(sessionWindowOf(dec15("09:00"))).toBe(SESSIONS.london);
    expect(sessionWindowOf(dec15("15:30"))).toBe(SESSIONS.nyAm);
    expect(sessionWindowOf(dec15("00:00"))).toBe(SESSIONS.asia);
  });

  it("27.10.2026: London still opens at 09:00 Belgrade, New York's lines come an hour earlier", () => {
    expect(sessionWindowOf(oct27("07:59"))).toBe(SESSIONS.preLondon); // 08:59 Belgrade
    expect(sessionWindowOf(oct27("08:00"))).toBe(SESSIONS.london); // 09:00 Belgrade, 08:00 London
    expect(sessionWindowOf(oct27("12:00"))).toBe(SESSIONS.nyPreOpen); // 13:00 Belgrade = 08:00 New York
    expect(sessionWindowOf(oct27("13:30"))).toBe(SESSIONS.nyAm); // 14:30 Belgrade = 09:30 New York
    expect(sessionWindowOf(oct27("22:00"))).toBe(SESSIONS.asia); // 23:00 Belgrade = 18:00 New York
  });

  it("every label it can return is declared, in day order, and an unreadable time is unknown", () => {
    for (let h = 0; h < 24; h++) {
      expect(SESSION_WINDOWS, `${h}:15`).toContain(sessionWindowOf(oct13(`${h}:15`)));
    }
    expect(SESSION_WINDOWS[0]).toBe(SESSIONS.asia);
    expect(SESSION_WINDOWS[SESSION_WINDOWS.length - 1]).toBe(SESSIONS.afterClose);
    expect(sessionWindowOf(null)).toBeNull();
    expect(sessionWindowOf("not a date")).toBeNull();
  });
});

describe("minutes after the session's own open (phase N)", () => {
  it("London from 09:00 Belgrade, New York from 15:30", () => {
    expect(afterSessionOpen(oct13("09:24"))).toEqual({ session: "London", minutes: 24 });
    expect(afterSessionOpen(oct13("09:44"))).toEqual({ session: "London", minutes: 44 });
    expect(afterSessionOpen(oct13("15:45"))).toEqual({ session: "NY", minutes: 15 });
    expect(afterSessionOpen(oct27("13:40"))).toEqual({ session: "NY", minutes: 10 }); // 14:40 Belgrade
  });

  it("before either open there is none", () => {
    for (const t of ["00:30", "07:00", "08:59", "14:30", "15:29"]) {
      expect(minutesAfterOpen(oct13(t)), t).toBeNull();
    }
    expect(minutesAfterOpen("not a date")).toBeNull();
  });

  it("buckets: 13.10. is 15–30 and 30–60, not 'before the open'", () => {
    expect(openOffsetBucket("2026-10-13T07:24:39Z")).toBe("15–30 min");
    expect(openOffsetBucket("2026-10-13T07:44:32Z")).toBe("30–60 min");
    expect(openOffsetBucket(oct13("09:00"))).toBe("0–15 min");
    expect(openOffsetBucket(oct13("11:30"))).toBe("2 h +");
    expect(openOffsetBucket(oct13("14:10"))).toBe("Pre otvaranja");
    for (let h = 0; h < 24; h++) expect(OPEN_OFFSET_BUCKETS).toContain(openOffsetBucket(oct13(`${h}:00`)));
    expect(openOffsetBucket(null)).toBeNull();
  });
});
