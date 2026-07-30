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
  type AutoResults,
} from "./compliance";
import { isoWeekdayOfDayKey } from "../time";
import { canEditDay, type TrackerCheckin, type TrackerRule } from "../tracker-types";
import type { AutoRuleKey, AutoVerdict } from "./auto-rules";

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
    );
    expect(rows).toEqual([{ rule_id: "a", checked: false }]);
  });

  it("skips retired rules — they are not on the checklist being sealed", () => {
    const rows = freezeAutoCheckins(
      [rule({ id: "gone", auto_key: "stop_loss_set", deleted_at: "2026-01-01T00:00:00Z" })],
      autoOf({ stop_loss_set: "pass" }),
    );
    expect(rows).toEqual([]);
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
