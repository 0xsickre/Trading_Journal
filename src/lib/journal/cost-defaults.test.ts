import { describe, expect, it } from "vitest";
import { NO_COST_DEFAULTS, prefillFee } from "./cost-defaults";

const defaults = {
  default_commission_per_unit: 2.5,
  default_fee_fixed: 1,
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
