import { describe, expect, it } from "vitest";
import { dailyReportSchema, type SaveDailyReportInput } from "./daily-report-schema";

const base: SaveDailyReportInput = {
  sleep_quality_pct: null,
  sleep_hours: null,
  work_shift: null,
  with_child: null,
  no_trade_day: false,
  psychology_tags: [],
  tomorrow_change: null,
  opportunities: [],
};

const opp = (note: string, easiest = false) => ({ note, in_playbook: true, could_take: true, easiest });

describe("what /daily saves (phase G)", () => {
  it("takes the state before the session, hours to one decimal", () => {
    const r = dailyReportSchema.parse({ ...base, sleep_quality_pct: 80, sleep_hours: 6.25, work_shift: "prva", with_child: true });
    expect(r).toMatchObject({ sleep_quality_pct: 80, sleep_hours: 6.3, work_shift: "prva", with_child: true });
  });

  it("refuses a state out of range or an unknown shift", () => {
    expect(dailyReportSchema.safeParse({ ...base, sleep_quality_pct: 101 }).success).toBe(false);
    expect(dailyReportSchema.safeParse({ ...base, sleep_hours: 25 }).success).toBe(false);
    expect(dailyReportSchema.safeParse({ ...base, work_shift: "noćna" }).success).toBe(false);
  });

  it("does not carry the retired mental rating", () => {
    const r = dailyReportSchema.parse({ ...base, mental_temp: 4 } as SaveDailyReportInput);
    expect("mental_temp" in r).toBe(false);
  });

  it("stores an empty 'sutra menjam' as null, trimmed text as written", () => {
    expect(dailyReportSchema.parse({ ...base, tomorrow_change: "   " }).tomorrow_change).toBeNull();
    expect(dailyReportSchema.parse({ ...base, tomorrow_change: " Čekam MSS. " }).tomorrow_change).toBe("Čekam MSS.");
  });

  it("takes up to three opportunities, one of them the easiest", () => {
    expect(dailyReportSchema.parse({ ...base, opportunities: [opp("a", true), opp("b"), opp("c")] }).opportunities).toHaveLength(3);
    const four = dailyReportSchema.safeParse({ ...base, opportunities: [opp("a"), opp("b"), opp("c"), opp("d")] });
    expect(four.success).toBe(false);
    const two = dailyReportSchema.safeParse({ ...base, opportunities: [opp("a", true), opp("b", true)] });
    expect(two.success).toBe(false);
    expect(two.error?.issues[0]?.message).toBe("Samo jedna prilika može biti najlakša.");
    expect(dailyReportSchema.safeParse({ ...base, opportunities: [opp("  ")] }).success).toBe(false);
  });
});
