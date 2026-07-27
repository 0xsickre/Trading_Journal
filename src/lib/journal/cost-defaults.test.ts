import { describe, expect, it } from "vitest";
import {
  NO_COST_DEFAULTS,
  nightsBetween,
  prefillFee,
  prefillSwap,
} from "./cost-defaults";

const defaults = {
  default_commission_per_unit: 2.5,
  default_fee_fixed: 1,
  default_swap_per_day: -0.8,
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
  it("accrues per unit per night and stays negative as a cost", () => {
    expect(prefillSwap(2, 5, defaults)).toBe(-8); // 2 * 5 * -0.8
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
  it("counts whole nights only", () => {
    expect(
      nightsBetween("2026-01-01T10:00:00Z", "2026-01-04T09:00:00Z"),
    ).toBe(2);
    expect(
      nightsBetween("2026-01-01T10:00:00Z", "2026-01-04T11:00:00Z"),
    ).toBe(3);
  });

  it("is zero within the same day and for reversed or missing inputs", () => {
    expect(nightsBetween("2026-01-01T09:00:00Z", "2026-01-01T17:00:00Z")).toBe(0);
    expect(nightsBetween("2026-01-05T00:00:00Z", "2026-01-01T00:00:00Z")).toBe(0);
    expect(nightsBetween(null, "2026-01-01T00:00:00Z")).toBe(0);
    expect(nightsBetween("bad date", "2026-01-01T00:00:00Z")).toBe(0);
  });
});
