import { describe, expect, it } from "vitest";
import { OPEN_OFFSET_BUCKETS, openOffsetBucket, sessionWindowOf, SESSION_WINDOWS } from "./session-window";

// 29.09.2026 is US summer time: 09:30 ET = 13:30 UTC.
const at = (hhmmUtc: string) => `2026-09-29T${hhmmUtc}:00Z`;
// 15.12.2026 is US winter time: 09:30 ET = 14:30 UTC.
const winter = (hhmmUtc: string) => `2026-12-15T${hhmmUtc}:00Z`;

describe("session windows, read on New York's clock (F5.2, L1)", () => {
  it("puts each entry in its window, edges belonging to the window that starts there", () => {
    expect(sessionWindowOf(at("12:00"))).toBe("Pre-open 08:00–09:30");
    expect(sessionWindowOf(at("13:30"))).toBe("Open 09:30–10:00");
    expect(sessionWindowOf(at("13:59"))).toBe("Open 09:30–10:00");
    expect(sessionWindowOf(at("14:00"))).toBe("Morning 10:00–11:30");
    expect(sessionWindowOf(at("15:30"))).toBe("Lunch 11:30–13:30");
    expect(sessionWindowOf(at("17:30"))).toBe("Afternoon 13:30–15:00");
    expect(sessionWindowOf(at("19:00"))).toBe("Last hour 15:00–");
    expect(sessionWindowOf(at("20:05"))).toBe("Last hour 15:00–");
  });

  it("the Globex night runs from the 18:00 reopen to 08:00", () => {
    expect(sessionWindowOf(at("22:00"))).toBe("Globex night 18:00–08:00"); // 18:00 ET
    expect(sessionWindowOf(at("03:00"))).toBe("Globex night 18:00–08:00"); // 23:00 ET
    expect(sessionWindowOf(at("11:59"))).toBe("Globex night 18:00–08:00"); // 07:59 ET
  });

  it("follows the US clock through the winter, not a fixed UTC offset", () => {
    expect(sessionWindowOf(winter("14:30"))).toBe("Open 09:30–10:00");
    expect(sessionWindowOf(winter("13:30"))).toBe("Pre-open 08:00–09:30");
  });

  it("every window it can return is declared, and an unreadable time is unknown", () => {
    for (let h = 0; h < 24; h++) {
      const w = sessionWindowOf(`2026-09-29T${String(h).padStart(2, "0")}:15:00Z`);
      expect(SESSION_WINDOWS, `${h}:15 UTC`).toContain(w);
    }
    expect(sessionWindowOf(null)).toBeNull();
    expect(sessionWindowOf("not a date")).toBeNull();
  });
});

describe("minutes after the 09:30 open", () => {
  it("buckets an entry by how long after the open it was taken", () => {
    expect(openOffsetBucket(at("13:29"))).toBe("Before the open");
    expect(openOffsetBucket(at("13:30"))).toBe("0–15 min");
    expect(openOffsetBucket(at("13:44"))).toBe("0–15 min");
    expect(openOffsetBucket(at("13:45"))).toBe("15–30 min");
    expect(openOffsetBucket(at("14:00"))).toBe("30–60 min");
    expect(openOffsetBucket(at("14:30"))).toBe("1–2 h");
    expect(openOffsetBucket(at("15:30"))).toBe("2 h +");
  });

  it("the evening session is before the NEXT open, and every result is declared", () => {
    expect(openOffsetBucket(at("22:30"))).toBe("Before the open");
    for (let h = 0; h < 24; h++) {
      expect(OPEN_OFFSET_BUCKETS).toContain(openOffsetBucket(`2026-09-29T${String(h).padStart(2, "0")}:00:00Z`));
    }
    expect(openOffsetBucket(null)).toBeNull();
  });
});
