import { describe, expect, it } from "vitest";
import { winRateOf } from "./analytics";
import {
  EXACT_ZERO_RANGE,
  resolveBreakevenRange,
  sharedBreakevenRange,
  type BreakevenConfig,
} from "./breakeven";
import { isFriday } from "./daily-report";
import { lifecycleStatusHint } from "./trade-lifecycle";
import { daysBetweenKeys } from "./open-positions";
import { isShortDirection } from "./plan-calculations";
import { tradeDirectionMultiplier } from "./position-stats";
import { accountTimezoneResolver, daysBetweenDayKeys, isoWeekdayOfDayKey } from "./time";

/**
 * ONE QUESTION, ONE ANSWER.
 *
 * Round 3 found the "two answers to one question" class seven times. Step 5
 * found eight more places answering the same question with their own
 * expression: win rate in six, the direction sign in three, a day difference in
 * three, the weekday in two, the breakeven band in five, the account zone in
 * five.
 *
 * While the copies gave the same answers, the duplication was merely a cost.
 * The danger is that editing ONE silently pulls the screens apart — the same
 * trade would have one win rate on the Dashboard and another on the calendar,
 * and nothing would fail.
 *
 * This file does not test the new functions (each has its own test). It tests
 * that the old copies are really gone, and that conventions which genuinely
 * DIFFER stay separated on purpose rather than by accident.
 */

describe("the direction sign — one predicate", () => {
  it("the multiplier is derived from the predicate, not from a second copy of the same expression", () => {
    for (const dir of [
      "Short", "short", "SHORT", "Short (swing)", "shorting",
      "Long", "long", "buy", "", null,
    ]) {
      expect(tradeDirectionMultiplier(dir), `smer: ${dir}`).toBe(
        isShortDirection(dir) ? -1 : 1,
      );
    }
  });

  it("anything not starting with 'short' is long, including empty and null", () => {
    // Deliberate, and worth writing down: an unknown direction reads as long
    // rather than failing the trade. The alternative would be that a trade with
    // no direction has no result.
    expect(isShortDirection(null)).toBe(false);
    expect(isShortDirection("")).toBe(false);
    expect(isShortDirection("sell")).toBe(false);
  });
});

describe("win rate — one formula", () => {
  it("breakeven is out of the denominator, and that is the only definition", () => {
    expect(winRateOf(2, 1)).toBeCloseTo((2 / 3) * 100, 10);
    expect(winRateOf(0, 5)).toBe(0);
    expect(winRateOf(5, 0)).toBe(100);
  });

  it("null without making a decision — the difference each copy used to settle for itself", () => {
    // Six copies each picked their own fallback: some 0, `month-calendar` a
    // "—". The formula now returns null, and each caller chooses what to do
    // with it at its own site — visibly, instead of buried in an expression.
    expect(winRateOf(0, 0)).toBeNull();
  });
});

describe("the day difference — two conventions, both deliberate", () => {
  it("the calendar difference is 0-based", () => {
    expect(daysBetweenDayKeys("2026-03-02", "2026-03-02")).toBe(0);
    expect(daysBetweenDayKeys("2026-03-02", "2026-03-05")).toBe(3);
  });

  it("the count of sessions held is 1-based and larger by exactly one", () => {
    // The open day counts as the first session. The difference in convention is
    // real and stays; what was removed is the second IMPLEMENTATION — a loop
    // adding one day at a time and counting steps up to 3650.
    expect(daysBetweenKeys("2026-03-02", "2026-03-02")).toBe(1);
    expect(daysBetweenKeys("2026-03-02", "2026-03-05")).toBe(4);

    for (const [from, to] of [
      ["2026-02-26", "2026-03-02"], // month boundary
      ["2024-02-27", "2024-03-01"], // leap year
      ["2026-12-30", "2027-01-02"], // year boundary
      ["2026-03-06", "2026-03-10"], // across the US clock change
    ]) {
      expect(daysBetweenKeys(from, to), `${from} → ${to}`).toBe(
        daysBetweenDayKeys(from, to) + 1,
      );
    }
  });

  it("a reversed order gives 0, not a negative number of sessions", () => {
    expect(daysBetweenKeys("2026-03-05", "2026-03-02")).toBe(0);
  });
});

describe("the weekday — one numbering", () => {
  it("isFriday agrees with the ISO numbering", () => {
    // 2026-03-06 is a Friday. `isFriday` used to go through
    // `parseISO().getDay()`, which was correct but required the reader to know
    // why — `time.ts` carried a "do not copy this pattern" warning around it.
    expect(isFriday("2026-03-06")).toBe(true);
    expect(isoWeekdayOfDayKey("2026-03-06")).toBe(5);

    for (const [day, iso] of [
      ["2026-03-02", 1], ["2026-03-03", 2], ["2026-03-04", 3],
      ["2026-03-05", 4], ["2026-03-06", 5], ["2026-03-07", 6],
      ["2026-03-08", 7],
    ] as const) {
      expect(isoWeekdayOfDayKey(day), day).toBe(iso);
      expect(isFriday(day), day).toBe(iso === 5);
    }
  });

  it("Sunday is 7, never 0 — the `Date#getDay` convention does not exist here", () => {
    expect(isoWeekdayOfDayKey("2026-03-08")).toBe(7);
  });
});

describe("the breakeven band — one rule for five screens", () => {
  const acct = (from: number, to: number): BreakevenConfig =>
    ({
      breakeven_from: from,
      breakeven_to: to,
      breakeven_unit: "currency",
      starting_balance: 10_000,
    }) as BreakevenConfig;

  it("the band applies when every account agrees", () => {
    const r = sharedBreakevenRange([acct(-20, 20), acct(-20, 20)]);
    expect(r).toEqual({ from: -20, to: 20 });
    expect(r).toEqual(resolveBreakevenRange(acct(-20, 20)));
  });

  it("accounts that disagree fall back to exact zero, not to the first band", () => {
    // A +$15 trade cannot be breakeven on one account and a win on another.
    // Taking the first band would mean applying somebody's rule to somebody
    // else's trades — so neither is applied.
    expect(sharedBreakevenRange([acct(-20, 20), acct(-5, 5)])).toEqual(
      EXACT_ZERO_RANGE,
    );
  });

  it("an empty set of accounts gives exact zero", () => {
    expect(sharedBreakevenRange([])).toEqual(EXACT_ZERO_RANGE);
  });

  it("one account gives its own band — this is the Dashboard filtered to an account", () => {
    // The difference between the Dashboard and the routes is in WHAT gets
    // passed, not in the rule: the Dashboard sends the selected accounts, the
    // routes send all of them. That difference is deliberate.
    expect(sharedBreakevenRange([acct(-50, 50)])).toEqual({ from: -50, to: 50 });
  });
});

describe("the account zone — one fallback chain", () => {
  const accounts = [
    { id: "a1", timezone: "Europe/Berlin" },
    { id: "a2", timezone: "Asia/Tokyo" },
  ];

  it("a trade carries its own account's zone", () => {
    const tz = accountTimezoneResolver(accounts, "Europe/Berlin");
    expect(tz("a1")).toBe("Europe/Berlin");
    expect(tz("a2")).toBe("Asia/Tokyo");
  });

  it("a trade with no account falls back to the PRIMARY one, not to a hardcoded New York", () => {
    // This was a genuine difference, not merely duplication: `dashboard.tsx`
    // had `?? "America/New_York"` with no fallback to the primary account,
    // while `/calendar` and `/playbooks` fell back to `primary?.timezone`. A
    // trade with no `account_id` is created whenever an account is deleted
    // (`ON DELETE SET NULL`), and on a Berlin account such a trade would be
    // dated into two different calendar columns.
    const tz = accountTimezoneResolver(accounts, "Europe/Berlin");
    expect(tz(null)).toBe("Europe/Berlin");
    expect(tz(undefined)).toBe("Europe/Berlin");
    expect(tz("nepostojeci-id")).toBe("Europe/Berlin");
  });

  it("with no primary account it falls back to DEFAULT_TZ", () => {
    const tz = accountTimezoneResolver([], null);
    expect(tz(null)).toBe("America/New_York");
  });
});

describe("status messages — one language", () => {
  it("no status answers in Serbian", () => {
    // `lifecycleStatusHint("closed")` used to return "Zatvoren trade." — the
    // one Serbian sentence among five, and on the most common status in the
    // book. The text is the `title` on every badge in the grid, so the user saw
    // it more often than any other message in this module.
    //
    // The check is on LETTERS, not on a word list: a diacritic is the only
    // reliable marker, and any new message that slips through in Serbian
    // carries at least one.
    for (const status of ["planned", "missed", "open", "partial", "closed"]) {
      const hint = lifecycleStatusHint(status);
      expect(hint, status).not.toMatch(/[čćžšđČĆŽŠĐ]/);
      expect(hint.length, status).toBeGreaterThan(0);
    }
  });

  it("every status has a message, an unknown one does not", () => {
    expect(lifecycleStatusHint("closed")).toBe("Closed trade — fully exited.");
    expect(lifecycleStatusHint("izmisljen")).toBe("");
  });
});
