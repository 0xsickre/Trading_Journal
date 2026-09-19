import { describe, expect, it } from "vitest";
import {
  complianceByDay,
  computeComplianceSeries,
  computeDayCompliance,
  computeStreak,
  freezeAutoCheckins,
  meanCompliance,
  resolveAutoResults,
  ruleAppliesOn,
  ruleIsLiveOn,
  rulesLiveOn,
  type AutoResults,
} from "./compliance";
import {
  addDaysToDayKey,
  addMonthsToMonthKey,
  daysBetweenDayKeys,
  heatmapWindow,
  isoWeekdayOfDayKey,
  monthGridDays,
} from "../time";
import { canEditDay, type TrackerCheckin, type TrackerRule } from "../tracker-types";
import { configsFromRules, type AutoRuleKey, type AutoVerdict } from "./auto-rules";

const TODAY = "2026-07-29"; // a Wednesday

function rule(over: Partial<TrackerRule> & { id: string }): TrackerRule {
  return {
    text: over.id,
    stage: "trade",
    active_days: [1, 2, 3, 4, 5],
    auto_key: null,
    config: {},
    is_mandatory: false,
    sort_order: 0,
    created_at: "2020-01-01T00:00:00Z",
    deleted_at: null,
    ...over,
  };
}

const checkins = (entries: [string, boolean][]) =>
  new Map<string, TrackerCheckin>(
    entries.map(([rule_id, checked]) => [
      rule_id,
      { rule_id, report_date: "", checked, auto_evaluated: false },
    ]),
  );

const autoOf = (entries: Partial<Record<AutoRuleKey, AutoVerdict>>): AutoResults => {
  const out: AutoResults = {};
  for (const [k, v] of Object.entries(entries)) {
    out[k as AutoRuleKey] = {
      key: k as AutoRuleKey,
      verdict: v as AutoVerdict,
      reason: "ok",
      offenders: [],
      observed: null,
    };
  }
  return out;
};

const day = (
  date: string,
  rules: TrackerRule[],
  answers: Map<string, TrackerCheckin> = new Map(),
  auto: AutoResults = {},
  today = TODAY,
) => computeDayCompliance(date, rules, answers, auto, today);

describe("applicability", () => {
  it("excludes a rule created after the day — no retroactive failure", () => {
    // Without this, adding a rule today would wipe a year-long streak.
    const r = rule({ id: "new", created_at: "2026-07-20T00:00:00Z" });
    expect(ruleAppliesOn(r, "2026-07-15", {})).toBe(false);
    expect(ruleAppliesOn(r, "2026-07-20", {})).toBe(true);
    expect(ruleAppliesOn(r, "2026-07-21", {})).toBe(true);
  });

  it("keeps a retired rule applicable to the days before it was retired", () => {
    // Configuration is current state; history is what happened. Retiring a rule
    // tomorrow must not raise yesterday's compliance.
    const r = rule({ id: "old", deleted_at: "2026-07-22T00:00:00Z" });
    expect(ruleAppliesOn(r, "2026-07-21", {})).toBe(true);
    expect(ruleAppliesOn(r, "2026-07-22", {})).toBe(false);
    expect(ruleAppliesOn(r, "2026-07-23", {})).toBe(false);
  });

  it("excludes a rule on a weekday it does not run on", () => {
    const r = rule({ id: "weekdays", active_days: [1, 2, 3, 4, 5] });
    expect(isoWeekdayOfDayKey("2026-08-01")).toBe(6); // Saturday
    expect(ruleAppliesOn(r, "2026-08-01", {})).toBe(false);
  });

  it("drops an auto rule whose evaluator said not-applicable", () => {
    const r = rule({ id: "auto", auto_key: "max_loss_per_day" });
    expect(ruleAppliesOn(r, "2026-07-29", autoOf({ max_loss_per_day: "na" }))).toBe(false);
    expect(ruleAppliesOn(r, "2026-07-29", autoOf({ max_loss_per_day: "pass" }))).toBe(true);
    expect(ruleAppliesOn(r, "2026-07-29", autoOf({ max_loss_per_day: "fail" }))).toBe(true);
  });

  it("keeps an unscorable auto rule LIVE, so the checklist can still show it", () => {
    // The difference the checklist depends on: a money rule with no limit is not
    // scored, but it has to appear on the page saying why. Filtering the page by
    // ruleAppliesOn would delete the only place you can find out.
    const r = rule({ id: "auto", auto_key: "max_loss_per_day" });
    expect(ruleAppliesOn(r, "2026-07-29", autoOf({ max_loss_per_day: "na" }))).toBe(false);
    expect(ruleIsLiveOn(r, "2026-07-29")).toBe(true);
  });

  it("ruleIsLiveOn still enforces the three date and weekday conditions", () => {
    expect(
      ruleIsLiveOn(rule({ id: "a", created_at: "2026-07-20T00:00:00Z" }), "2026-07-15"),
    ).toBe(false);
    expect(
      ruleIsLiveOn(rule({ id: "b", deleted_at: "2026-07-22T00:00:00Z" }), "2026-07-23"),
    ).toBe(false);
    expect(
      ruleIsLiveOn(rule({ id: "c", active_days: [1, 2, 3, 4, 5] }), "2026-08-01"),
    ).toBe(false);
  });
});

describe("daily compliance", () => {
  it("drops `na` from both numerator and denominator", () => {
    const rules = [
      rule({ id: "manual" }),
      rule({ id: "auto", auto_key: "max_loss_per_day" }),
    ];
    const d = day(
      "2026-07-28",
      rules,
      checkins([["manual", true]]),
      autoOf({ max_loss_per_day: "na" }),
    );
    expect(d.applicable).toBe(1);
    expect(d.satisfied).toBe(1);
    expect(d.pct).toBe(100);
    expect(d.status).toBe("compliant");
  });

  it("counts an unanswered manual rule against a PAST day", () => {
    const d = day("2026-07-28", [rule({ id: "a" }), rule({ id: "b" })], checkins([["a", true]]));
    expect(d.applicable).toBe(2);
    expect(d.satisfied).toBe(1);
    expect(d.pct).toBe(50);
    expect(d.status).toBe("broken");
    expect(d.missedRuleIds).toEqual(["b"]);
  });

  it("has no opinion on a day nothing applied to", () => {
    const d = day("2026-08-01", [rule({ id: "weekday", active_days: [1, 2, 3, 4, 5] })]);
    expect(d.pct).toBeNull();
    expect(d.status).toBe("skipped");
  });

  it("leaves today pending while a manual rule is merely unanswered", () => {
    const d = day(TODAY, [rule({ id: "a" })]);
    expect(d.status).toBe("pending");
  });

  it("breaks today when a rule was explicitly answered NO", () => {
    // Pending is "you still have hours", not "nothing counts today".
    const d = day(TODAY, [rule({ id: "a" })], checkins([["a", false]]));
    expect(d.status).toBe("broken");
  });

  it("does not soften a mandatory rule versus a user rule", () => {
    // is_mandatory governs editability, not scoring. A rule you wrote and then
    // ignore is precisely the discipline failure this is meant to surface.
    const d = day(
      "2026-07-28",
      [rule({ id: "mine", is_mandatory: false })],
      checkins([["mine", false]]),
    );
    expect(d.pct).toBe(0);
    expect(d.status).toBe("broken");
  });
});

describe("streak", () => {
  const series = (entries: [string, "compliant" | "broken" | "skipped" | "pending"][]) =>
    entries.map(([date, status]) => ({
      date,
      applicable: status === "skipped" ? 0 : 1,
      satisfied: status === "compliant" ? 1 : 0,
      pct: status === "skipped" ? null : status === "compliant" ? 100 : 0,
      status,
      missedRuleIds: [],
      unansweredRuleIds: [],
    }));

  it("counts consecutive compliant days", () => {
    const s = computeStreak(
      series([
        ["2026-07-27", "compliant"],
        ["2026-07-28", "compliant"],
        ["2026-07-29", "compliant"],
      ]),
    );
    expect(s.current).toBe(3);
  });

  it("steps over a skipped day without breaking or extending", () => {
    // Breaking on an excluded Saturday would cap every weekday trader at 5.
    const s = computeStreak(
      series([
        ["2026-07-27", "compliant"],
        ["2026-08-01", "skipped"],
        ["2026-08-03", "compliant"],
      ]),
    );
    expect(s.current).toBe(2);
  });

  it("does not let a pending today break the streak", () => {
    const s = computeStreak(
      series([
        ["2026-07-28", "compliant"],
        [TODAY, "pending"],
      ]),
    );
    expect(s.current).toBe(1);
  });

  it("stops at a broken day and remembers when", () => {
    const s = computeStreak(
      series([
        ["2026-07-20", "compliant"],
        ["2026-07-21", "compliant"],
        ["2026-07-22", "compliant"],
        ["2026-07-23", "broken"],
        ["2026-07-24", "compliant"],
      ]),
    );
    expect(s.current).toBe(1);
    expect(s.longest).toBe(3);
    expect(s.lastBrokenOn).toBe("2026-07-23");
  });

  it("reports the running streak as longest when it is the best one", () => {
    const s = computeStreak(
      series([
        ["2026-07-27", "compliant"],
        ["2026-07-28", "compliant"],
      ]),
    );
    expect(s.longest).toBe(2);
  });

  it("is zero on an empty history rather than throwing", () => {
    expect(computeStreak([])).toEqual({ current: 0, longest: 0, lastBrokenOn: null });
  });
});

describe("series and aggregates", () => {
  it("excludes future days from the series", () => {
    const s = computeComplianceSeries(
      ["2026-07-28", TODAY, "2026-07-30"],
      [rule({ id: "a" })],
      new Map(),
      () => ({}),
      TODAY,
    );
    expect(s.map((d) => d.date)).toEqual(["2026-07-28", TODAY]);
  });

  it("averages by DAY, so a busy day does not outweigh a quiet one", () => {
    const s = [
      { date: "d1", applicable: 12, satisfied: 6, pct: 50, status: "broken" as const, missedRuleIds: [], unansweredRuleIds: [] },
      { date: "d2", applicable: 3, satisfied: 3, pct: 100, status: "compliant" as const, missedRuleIds: [], unansweredRuleIds: [] },
    ];
    // Pooled counts would give 9/15 = 60 %. By day it is 75 %.
    expect(meanCompliance(s)).toBe(75);
  });

  it("has no mean when no day produced a percentage", () => {
    expect(meanCompliance([])).toBeNull();
  });

  it("omits null days from the heatmap map", () => {
    const map = complianceByDay([
      { date: "d1", applicable: 0, satisfied: 0, pct: null, status: "skipped", missedRuleIds: [], unansweredRuleIds: [] },
      { date: "d2", applicable: 1, satisfied: 1, pct: 100, status: "compliant", missedRuleIds: [], unansweredRuleIds: [] },
    ]);
    expect([...map.keys()]).toEqual(["d2"]);
  });
});

describe("rulesLiveOn is what every per-day computation starts from", () => {
  it("hands the evaluator the limit in force that day, not a retired one", () => {
    // The unique index on `auto_key` is PARTIAL — it covers live rules only —
    // so a retired rule and its replacement coexist under one key.
    // `configsFromRules` lets the last one win, and the order is `sort_order`,
    // which the user can drag around. Built once for a whole span, the dead
    // 4 % limit was scoring days the 10 % limit governs.
    const retired = rule({
      id: "old",
      auto_key: "max_loss_per_day",
      config: { pct: 4 },
      deleted_at: "2026-06-01T00:00:00Z",
      sort_order: 9,
    });
    const live = rule({
      id: "new",
      auto_key: "max_loss_per_day",
      config: { pct: 10 },
      created_at: "2026-06-01T00:00:00Z",
      sort_order: 1,
    });
    const both = [live, retired]; // as `sort_order` would order them

    expect(configsFromRules(both).max_loss_per_day).toEqual({ pct: 4 });
    expect(
      configsFromRules(rulesLiveOn(both, TODAY)).max_loss_per_day,
    ).toEqual({ pct: 10 });
  });

  it("still answers with the OLD limit for a day the old rule governed", () => {
    // Not merely "prefer the live rule": a day in May was lived under the 4 %
    // limit and must keep being scored against it.
    const retired = rule({
      id: "old",
      auto_key: "max_loss_per_day",
      config: { pct: 4 },
      created_at: "2026-01-01T00:00:00Z",
      deleted_at: "2026-06-01T00:00:00Z",
    });
    const live = rule({
      id: "new",
      auto_key: "max_loss_per_day",
      config: { pct: 10 },
      created_at: "2026-06-01T00:00:00Z",
    });
    expect(
      configsFromRules(rulesLiveOn([live, retired], "2026-05-20")).max_loss_per_day,
    ).toEqual({ pct: 4 });
  });
});

describe("freezing at lock time", () => {
  it("writes a row for a not-applicable auto rule too", () => {
    // The resurrection hole: without a NULL row, a later import backfilling a
    // trade would revive these rules on a day that is supposed to be sealed.
    const rows = freezeAutoCheckins(
      [
        rule({ id: "a", auto_key: "max_loss_per_day" }),
        rule({ id: "b", auto_key: "stop_loss_set" }),
        rule({ id: "manual" }),
      ],
      autoOf({ max_loss_per_day: "na", stop_loss_set: "pass" }),
      TODAY,
    );
    expect(rows).toEqual([
      { rule_id: "a", checked: null },
      { rule_id: "b", checked: true },
    ]);
  });

  it("records a failure as false, not as absent", () => {
    const rows = freezeAutoCheckins(
      [rule({ id: "a", auto_key: "playbook_linked" })],
      autoOf({ playbook_linked: "fail" }),
      TODAY,
    );
    expect(rows).toEqual([{ rule_id: "a", checked: false }]);
  });

  it("skips a rule already retired on the day being sealed", () => {
    const rows = freezeAutoCheckins(
      [rule({ id: "gone", auto_key: "stop_loss_set", deleted_at: "2026-01-01T00:00:00Z" })],
      autoOf({ stop_loss_set: "pass" }),
      TODAY,
    );
    expect(rows).toEqual([]);
  });

  it("FREEZES a rule retired later, because it was live on the sealed day", () => {
    // The gap that made the day parameter necessary. Locking a past day after
    // retiring a rule used to skip it here while `ruleAppliesOn` still counted
    // it on read — so it stayed in the denominator with no frozen verdict, and
    // re-derived itself every time a trade on that day was corrected. Which is
    // the exact thing the lock exists to stop.
    const retiredLater = rule({
      id: "later",
      auto_key: "stop_loss_set",
      deleted_at: "2026-07-30T00:00:00Z", // the day AFTER TODAY
    });
    const auto = autoOf({ stop_loss_set: "pass" });

    expect(ruleAppliesOn(retiredLater, TODAY, auto)).toBe(true);
    expect(freezeAutoCheckins([retiredLater], auto, TODAY)).toEqual([
      { rule_id: "later", checked: true },
    ]);
  });

  it("skips a rule that does not run on the sealed day's weekday", () => {
    // Same one filter, other half: a Monday-only rule sealed on a Wednesday.
    const mondayOnly = rule({
      id: "mon",
      auto_key: "max_loss_per_day",
      active_days: [1],
    });
    expect(
      freezeAutoCheckins([mondayOnly], autoOf({ max_loss_per_day: "pass" }), TODAY),
    ).toEqual([]);
  });

  it("skips a rule created after the day being sealed", () => {
    const future = rule({
      id: "new",
      auto_key: "playbook_linked",
      created_at: "2026-08-15T00:00:00Z",
    });
    expect(
      freezeAutoCheckins([future], autoOf({ playbook_linked: "pass" }), TODAY),
    ).toEqual([]);
  });
});

describe("reading a sealed day back", () => {
  const frozen = (
    entries: [string, boolean | null][],
  ): Map<string, TrackerCheckin> =>
    new Map(
      entries.map(([rule_id, checked]) => [
        rule_id,
        { rule_id, report_date: "2026-07-20", checked, auto_evaluated: true },
      ]),
    );

  const r = rule({ id: "a", auto_key: "stop_loss_set" });

  it("lets the frozen verdict beat the live one", () => {
    // The whole point of the lock. Without this the sealed day re-scores itself
    // the moment a trade from it is corrected — and correcting trades on a locked
    // day is deliberately allowed.
    const out = resolveAutoResults([r], autoOf({ stop_loss_set: "pass" }), frozen([["a", false]]));
    expect(out.stop_loss_set?.verdict).toBe("fail");
    expect(out.stop_loss_set?.reason).toBe("frozen");
  });

  it("keeps a frozen not-applicable out of the denominator", () => {
    // A null row is an ANSWER — "evaluated, does not apply" — so a backfilled
    // trade must not be able to revive the rule on a sealed day.
    const live = autoOf({ stop_loss_set: "fail" });
    const out = resolveAutoResults([r], live, frozen([["a", null]]));
    expect(out.stop_loss_set?.verdict).toBe("na");
    expect(ruleAppliesOn(r, "2026-07-20", out)).toBe(false);
    expect(day("2026-07-20", [r], new Map(), out).applicable).toBe(0);
  });

  it("drops offenders rather than pairing a sealed verdict with today's trades", () => {
    const live: AutoResults = {
      stop_loss_set: {
        key: "stop_loss_set",
        verdict: "fail",
        reason: "violated",
        offenders: ["t1", "t2"],
        observed: null,
      },
    };
    expect(resolveAutoResults([r], live, frozen([["a", true]])).stop_loss_set)
      .toMatchObject({ verdict: "pass", offenders: [] });
  });

  it("leaves an unlocked day untouched, and returns the very same object", () => {
    // Identity, not just equality: every unlocked day goes through here, so the
    // no-freeze path must not allocate a copy per day of the series.
    const live = autoOf({ stop_loss_set: "pass" });
    expect(resolveAutoResults([r], live, new Map())).toBe(live);
    // A manual answer on the same day is not a freeze and must not overlay.
    expect(resolveAutoResults([r], live, checkins([["a", false]]))).toBe(live);
  });
});

describe("canEditDay", () => {
  it("is false only once the day carries a lock timestamp", () => {
    expect(canEditDay({ locked_at: "2026-07-28T20:00:00Z" })).toBe(false);
    expect(canEditDay({ locked_at: null })).toBe(true);
    expect(canEditDay(null)).toBe(true);
    expect(canEditDay(undefined)).toBe(true);
  });
});

describe("isoWeekdayOfDayKey", () => {
  it("numbers Sunday 7, not 0", () => {
    expect(isoWeekdayOfDayKey("2026-08-02")).toBe(7);
    expect(isoWeekdayOfDayKey("2026-07-29")).toBe(3);
    expect(isoWeekdayOfDayKey("2026-08-01")).toBe(6);
  });

  it("returns 0 for a malformed key, which no active_days can match", () => {
    expect(isoWeekdayOfDayKey("nope")).toBe(0);
    expect(isoWeekdayOfDayKey("")).toBe(0);
  });
});

describe("addDaysToDayKey", () => {
  it("steps forward and back across month and year ends", () => {
    expect(addDaysToDayKey("2026-07-31", 1)).toBe("2026-08-01");
    expect(addDaysToDayKey("2026-08-01", -1)).toBe("2026-07-31");
    expect(addDaysToDayKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToDayKey("2027-01-01", -1)).toBe("2026-12-31");
  });

  it("handles a leap day", () => {
    expect(addDaysToDayKey("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDaysToDayKey("2028-02-29", 1)).toBe("2028-03-01");
    // 2026 is not a leap year, so the same step skips the 29th.
    expect(addDaysToDayKey("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("is a no-op for zero and stable over a round trip", () => {
    expect(addDaysToDayKey("2026-07-29", 0)).toBe("2026-07-29");
    expect(addDaysToDayKey(addDaysToDayKey("2026-07-29", 182), -182)).toBe(
      "2026-07-29",
    );
  });

  it("does not drift across a DST boundary", () => {
    // The bug this replaces: `new Date()` + setDate resolves in the BROWSER's
    // zone, so a 23- or 25-hour day could land the calendar on the wrong date.
    // These are US and EU DST switch weekends; UTC arithmetic ignores both.
    expect(addDaysToDayKey("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDaysToDayKey("2026-03-08", 1)).toBe("2026-03-09");
    expect(addDaysToDayKey("2026-11-01", 1)).toBe("2026-11-02");
    expect(addDaysToDayKey("2026-10-25", 1)).toBe("2026-10-26");
  });

  it("returns a malformed key unchanged rather than NaN-NaN-NaN", () => {
    expect(addDaysToDayKey("nope", 3)).toBe("nope");
    expect(addDaysToDayKey("", 1)).toBe("");
  });

  it("walks a 26-week window back to the expected first day", () => {
    // What the heatmap does: 182 days ending today, inclusive.
    expect(addDaysToDayKey("2026-08-01", -(26 * 7 - 1))).toBe("2026-02-01");
  });
});

describe("daysBetweenDayKeys", () => {
  it("counts whole days, signed, with the same day at zero", () => {
    expect(daysBetweenDayKeys("2026-08-01", "2026-08-01")).toBe(0);
    expect(daysBetweenDayKeys("2026-08-01", "2026-08-02")).toBe(1);
    expect(daysBetweenDayKeys("2026-08-02", "2026-08-01")).toBe(-1);
  });

  it("crosses month, year and leap boundaries", () => {
    expect(daysBetweenDayKeys("2026-07-31", "2026-08-01")).toBe(1);
    expect(daysBetweenDayKeys("2026-12-31", "2027-01-01")).toBe(1);
    // 2028 is a leap year: February carries 29 days.
    expect(daysBetweenDayKeys("2028-02-01", "2028-03-01")).toBe(29);
    expect(daysBetweenDayKeys("2026-02-01", "2026-03-01")).toBe(28);
    expect(daysBetweenDayKeys("2026-01-01", "2026-12-31")).toBe(364);
  });

  it("returns a whole number across a DST switch", () => {
    // The reason this is UTC string arithmetic: a 23-hour day divided by 86.4M
    // ms is 0.958, and a naive floor would report 0 days between two different
    // dates. These are the US and EU switch weekends.
    expect(daysBetweenDayKeys("2026-03-07", "2026-03-09")).toBe(2);
    expect(daysBetweenDayKeys("2026-10-24", "2026-11-02")).toBe(9);
  });

  it("returns 0 for a malformed key instead of NaN", () => {
    expect(daysBetweenDayKeys("nope", "2026-08-01")).toBe(0);
    expect(daysBetweenDayKeys("2026-08-01", "")).toBe(0);
  });
});

describe("heatmapWindow", () => {
  const WEEKS = 26;

  it("always ends on a Saturday and starts on a Sunday", () => {
    // Rows read Sun→Sat, so a start that is not Sunday shifts every cell one row
    // — a silent failure, which is why this is pinned for all seven weekdays.
    for (let i = 0; i < 7; i++) {
      const endDay = addDaysToDayKey("2026-07-26", i); // Sun 26 Jul → Sat 1 Aug
      const { start, end } = heatmapWindow(endDay, WEEKS);
      expect(isoWeekdayOfDayKey(end)).toBe(6); // Saturday
      expect(isoWeekdayOfDayKey(start)).toBe(7); // Sunday
    }
  });

  it("keeps the anchor day inside the window", () => {
    // The bug this replaces put "today" outside the grid entirely for anyone
    // whose browser zone ran ahead of their account zone.
    for (let i = 0; i < 7; i++) {
      const endDay = addDaysToDayKey("2026-07-26", i);
      const { start, end } = heatmapWindow(endDay, WEEKS);
      expect(start <= endDay).toBe(true);
      expect(endDay <= end).toBe(true);
    }
  });

  it("spans exactly weeks × 7 days", () => {
    const { start, end } = heatmapWindow("2026-07-29", WEEKS);
    expect(addDaysToDayKey(start, WEEKS * 7 - 1)).toBe(end);
  });

  it("pads a Sunday forward by six days, not back by one", () => {
    // ISO numbers Sunday 7, but it STARTS the display week. Treating it as the
    // last day would cut the current week off the grid.
    const { end } = heatmapWindow("2026-08-02", WEEKS); // a Sunday
    expect(end).toBe("2026-08-08");
  });

  it("leaves a Saturday anchor as the end", () => {
    const { end } = heatmapWindow("2026-08-01", WEEKS); // a Saturday
    expect(end).toBe("2026-08-01");
  });
});

describe("addMonthsToMonthKey", () => {
  it("rolls the year in both directions", () => {
    expect(addMonthsToMonthKey("2026-12", 1)).toBe("2027-01");
    expect(addMonthsToMonthKey("2027-01", -1)).toBe("2026-12");
    expect(addMonthsToMonthKey("2026-01", -1)).toBe("2025-12");
  });

  it("steps whole months without landing on a day that does not exist", () => {
    // Anchored on the 1st on purpose: anchoring on the current day would turn
    // 31 January + 1 month into 2 March.
    expect(addMonthsToMonthKey("2026-01", 1)).toBe("2026-02");
    expect(addMonthsToMonthKey("2026-03", -1)).toBe("2026-02");
    expect(addMonthsToMonthKey("2026-08", 0)).toBe("2026-08");
    expect(addMonthsToMonthKey("2026-08", 12)).toBe("2027-08");
  });

  it("returns a malformed key unchanged", () => {
    expect(addMonthsToMonthKey("2026-8", 1)).toBe("2026-8");
    expect(addMonthsToMonthKey("nope", 1)).toBe("nope");
  });
});

describe("monthGridDays", () => {
  const first = (m: string) => monthGridDays(m)[0];
  const last = (m: string) => monthGridDays(m).at(-1)!;

  it("always starts on a Monday and ends on a Sunday", () => {
    for (const m of ["2026-01", "2026-02", "2026-08", "2026-11", "2027-05"]) {
      expect(isoWeekdayOfDayKey(first(m))).toBe(1);
      expect(isoWeekdayOfDayKey(last(m))).toBe(7);
    }
  });

  it("spans whole weeks — 28, 35 or 42 days, never a partial row", () => {
    for (const m of ["2026-01", "2026-02", "2026-08", "2027-02", "2028-02"]) {
      expect(monthGridDays(m).length % 7).toBe(0);
      expect([28, 35, 42]).toContain(monthGridDays(m).length);
    }
  });

  it("contains every day of the month it is asked about", () => {
    const days = monthGridDays("2026-08"); // 31 days
    for (let d = 1; d <= 31; d++) {
      expect(days).toContain(`2026-08-${String(d).padStart(2, "0")}`);
    }
  });

  it("pads with the neighbouring months, not with blanks", () => {
    // 2026-08-01 is a Saturday, so the grid opens on Monday 27 July.
    const days = monthGridDays("2026-08");
    expect(days[0]).toBe("2026-07-27");
    expect(days.at(-1)).toBe("2026-09-06");
  });

  it("handles February in a leap and a non-leap year", () => {
    // 2028 is a leap year, 2027 is not — the 29th must appear only in 2028.
    expect(monthGridDays("2028-02")).toContain("2028-02-29");
    expect(monthGridDays("2027-02")).not.toContain("2027-02-29");
    expect(monthGridDays("2027-02")).toContain("2027-02-28");
  });

  it("needs only four rows for a February that starts on a Monday", () => {
    // 2027-02-01 is a Monday and February has 28 days — a perfect 4×7 grid, and
    // the case a fixed six-row grid would pad with two foreign weeks.
    expect(isoWeekdayOfDayKey("2027-02-01")).toBe(1);
    expect(monthGridDays("2027-02")).toHaveLength(28);
    expect(monthGridDays("2027-02")[0]).toBe("2027-02-01");
  });

  it("needs six rows for a 31-day month starting on a Sunday", () => {
    // 2026-03-01 is a Sunday: the grid opens on 23 February and cannot fit in 35.
    expect(isoWeekdayOfDayKey("2026-03-01")).toBe(7);
    expect(monthGridDays("2026-03")).toHaveLength(42);
  });

  it("returns nothing for a malformed key rather than a grid of NaN", () => {
    expect(monthGridDays("2026-8")).toEqual([]);
    expect(monthGridDays("2026-08-01")).toEqual([]);
    expect(monthGridDays("")).toEqual([]);
  });

  it("crosses a year boundary in both directions", () => {
    expect(monthGridDays("2026-01")).toContain("2025-12-29");
    expect(monthGridDays("2026-12")).toContain("2027-01-03");
  });
});

describe("an auto rule is scored by its evaluator, never by a checkin", () => {
  // The auto branch of `computeDayCompliance` had no test. It is the branch that
  // decides whether a machine-checked rule — "no day worse than −2 %" — counts
  // as kept, and it deliberately ignores `checkins`: a box the trader ticked
  // must not be able to overrule what the trades actually did.
  const auto = rule({ id: "auto", auto_key: "max_loss_per_day" });
  const manual = rule({ id: "manual" });

  it("counts a passing verdict as satisfied", () => {
    const d = day("2026-07-29", [auto], new Map(), autoOf({ max_loss_per_day: "pass" }));
    expect(d.applicable).toBe(1);
    expect(d.satisfied).toBe(1);
    expect(d.missedRuleIds).toEqual([]);
  });

  it("counts a failing verdict as missed, and never as merely unanswered", () => {
    // `unansweredRuleIds` drives the "today is still running" grace period. An
    // auto rule the evaluator already failed is a decided fact, so letting it
    // land there would hold a broken day at "pending" until midnight.
    const d = day("2026-07-29", [auto], new Map(), autoOf({ max_loss_per_day: "fail" }));
    expect(d.missedRuleIds).toEqual(["auto"]);
    expect(d.unansweredRuleIds).toEqual([]);
    expect(d.status).toBe("broken");
  });

  it("ignores a checkin that disagrees with the evaluator", () => {
    const d = day(
      "2026-07-29",
      [auto],
      checkins([["auto", true]]),
      autoOf({ max_loss_per_day: "fail" }),
    );
    expect(d.satisfied).toBe(0);
    expect(d.missedRuleIds).toEqual(["auto"]);
  });

  it("scores auto and manual rules side by side in one day", () => {
    const d = day(
      "2026-07-29",
      [auto, manual],
      checkins([["manual", true]]),
      autoOf({ max_loss_per_day: "pass" }),
    );
    expect(d.applicable).toBe(2);
    expect(d.satisfied).toBe(2);
    expect(d.pct).toBe(100);
  });
});

describe("the weekend is never scored", () => {
  // 2026-09-18 is a Friday; 19 and 20 are the weekend; 21 is Monday.
  const everyDay = rule({ id: "r", active_days: [1, 2, 3, 4, 5, 6, 7] });

  it("a rule saved with Saturday and Sunday still does not apply on them", () => {
    expect(ruleIsLiveOn(everyDay, "2026-09-18")).toBe(true);
    expect(ruleIsLiveOn(everyDay, "2026-09-19")).toBe(false);
    expect(ruleIsLiveOn(everyDay, "2026-09-20")).toBe(false);
  });

  it("an unanswered weekend neither breaks the streak nor drags the mean", () => {
    const answered = (d: string) => new Map([[d, checkins([["r", true]])]]);
    const byDate = new Map([...answered("2026-09-18"), ...answered("2026-09-21")]);
    const series = computeComplianceSeries(
      ["2026-09-18", "2026-09-19", "2026-09-20", "2026-09-21"],
      [everyDay],
      byDate,
      () => ({}),
      "2026-09-22",
    );
    expect(series.filter((d) => d.status === "skipped").map((d) => d.date)).toEqual([
      "2026-09-19",
      "2026-09-20",
    ]);
    expect(computeStreak(series).current).toBe(2);
    expect(meanCompliance(series)).toBe(100);
  });
});
