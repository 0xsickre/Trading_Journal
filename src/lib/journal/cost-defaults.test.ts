import { describe, expect, it } from "vitest";
import {
  NO_COST_DEFAULTS,
  nightsBetween,
  prefillFee,
  prefillSwap,
} from "./cost-defaults";

// Positive swap is a cost: net_pl is gross − fees − swap.
const defaults = {
  default_commission_per_unit: 2.5,
  default_fee_fixed: 1,
  default_swap_per_day: 0.8,
};

describe("prefillFee", () => {
  it("scales commission with size and adds the fixed fee once", () => {
    expect(prefillFee(3, defaults)).toBe(8.5); // 3 * 2.5 + 1
  });

  it("charges only the fixed fee when size is not known yet", () => {
    expect(prefillFee(0, defaults)).toBe(1);
    expect(prefillFee(Number.NaN, defaults)).toBe(1);
  });

  it("is zero when the account has no defaults configured", () => {
    expect(prefillFee(10, NO_COST_DEFAULTS)).toBe(0);
    expect(prefillFee(10)).toBe(0);
  });
});

describe("prefillSwap", () => {
  it("accrues per unit per night as a positive cost", () => {
    expect(prefillSwap(2, 5, defaults)).toBe(8); // 2 * 5 * 0.8
  });

  it("keeps a negative rate as a carry credit", () => {
    expect(
      prefillSwap(2, 5, { ...defaults, default_swap_per_day: -0.8 }),
    ).toBe(-8);
  });

  it("is zero for a same-day trade", () => {
    expect(prefillSwap(2, 0, defaults)).toBe(0);
  });

  it("ignores negative or unknown inputs", () => {
    expect(prefillSwap(-1, 5, defaults)).toBe(0);
    expect(prefillSwap(2, -3, defaults)).toBe(0);
  });
});

describe("nightsBetween", () => {
  const UTC = "UTC";

  it("counts calendar rollovers, not elapsed 24-hour blocks", () => {
    // Jan 1 → Jan 4 crosses three rollovers however late it opened or early it
    // closed, and a broker charges swap once per rollover. Measuring elapsed
    // hours made the first of these 2 and the second 3, for the same three
    // nights of exposure.
    expect(nightsBetween("2026-01-01T10:00:00Z", "2026-01-04T09:00:00Z", UTC)).toBe(3);
    expect(nightsBetween("2026-01-01T10:00:00Z", "2026-01-04T11:00:00Z", UTC)).toBe(3);
  });

  it("charges a night for an overnight hold shorter than 24 hours", () => {
    // 23:00 Monday to 01:00 Wednesday is 26 hours across two rollovers. The
    // elapsed-hours reading billed one night.
    expect(nightsBetween("2026-01-05T23:00:00Z", "2026-01-07T01:00:00Z", UTC)).toBe(2);
    // And a plain overnight: 22:00 to 08:00 is ten hours, but one rollover.
    expect(nightsBetween("2026-01-05T22:00:00Z", "2026-01-06T08:00:00Z", UTC)).toBe(1);
  });

  it("uses the account timezone to decide when the day turned", () => {
    // Same two instants, read in two zones. Opened 2026-01-06 04:00 UTC, which
    // is still 23:00 on the 5th in New York; closed 20:00 UTC the same UTC day,
    // which is 15:00 on the 6th in New York. UTC sees no rollover; New York
    // sees one — and New York is the account's day, so it is the one that pays.
    const open = "2026-01-06T04:00:00Z";
    const close = "2026-01-06T20:00:00Z";
    expect(nightsBetween(open, close, UTC)).toBe(0);
    expect(nightsBetween(open, close, "America/New_York")).toBe(1);
  });

  it("is zero within the same day and for reversed or missing inputs", () => {
    expect(nightsBetween("2026-01-01T09:00:00Z", "2026-01-01T17:00:00Z", UTC)).toBe(0);
    expect(nightsBetween("2026-01-05T00:00:00Z", "2026-01-01T00:00:00Z", UTC)).toBe(0);
    expect(nightsBetween(null, "2026-01-01T00:00:00Z", UTC)).toBe(0);
    expect(nightsBetween("bad date", "2026-01-01T00:00:00Z", UTC)).toBe(0);
  });
});
