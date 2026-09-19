import { describe, expect, it } from "vitest";
import { excursionSourcePatch } from "./excursion-source";

describe("who wrote the MAE/MFE after a save", () => {
  const prev = { max_drawdown_price: 1321.9, max_profit_price: 1331.1 };

  it("a save that did not change them says nothing — an MT5 value survives", () => {
    expect(excursionSourcePatch({ max_drawdown_price: 1321.9, max_profit_price: 1331.1 }, prev)).toEqual({});
    expect(excursionSourcePatch({ thesis: "x" }, prev)).toEqual({});
  });

  it("a changed value is the trader's, and marked manual", () => {
    expect(excursionSourcePatch({ max_drawdown_price: 1320, max_profit_price: 1331.1 }, prev)).toEqual({
      excursion_source: "manual",
    });
  });

  it("clearing both hands the trade back to the MT5 fill", () => {
    expect(excursionSourcePatch({ max_drawdown_price: null, max_profit_price: "" }, prev)).toEqual({
      excursion_source: null,
    });
  });

  it("a new trade typed with a value is manual from the start", () => {
    expect(excursionSourcePatch({ max_profit_price: 1331 }, null)).toEqual({ excursion_source: "manual" });
  });
});
