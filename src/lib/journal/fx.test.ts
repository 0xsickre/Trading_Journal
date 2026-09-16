import { describe, expect, it } from "vitest";
import { fxRateNeedsAttention, resolveFxRate } from "./fx";

describe("resolveFxRate", () => {
  it("a recorded rate beats everything else", () => {
    // History is not recomputed. Even when the currencies match, the recorded
    // value is what the trade carried — the same rule as point_value_at_trade.
    expect(
      resolveFxRate({ snapshot: 0.0067, quoteCurrency: "JPY", accountCurrency: "USD" }),
    ).toEqual({ rate: 0.0067, source: "snapshot" });

    expect(
      resolveFxRate({ snapshot: 1.02, quoteCurrency: "USD", accountCurrency: "USD" }),
    ).toEqual({ rate: 1.02, source: "snapshot" });
  });

  it("the same currency gives unity", () => {
    expect(
      resolveFxRate({ quoteCurrency: "USD", accountCurrency: "USD" }),
    ).toEqual({ rate: 1, source: "same_currency" });
  });

  it("different currencies with no recorded rate give null, not unity", () => {
    // This is the whole point of the module. A unit rate here would add 100,000
    // yen to dollars and print them with a `$` — an error of 149×, silently.
    expect(
      resolveFxRate({ quoteCurrency: "JPY", accountCurrency: "USD" }),
    ).toEqual({ rate: null, source: "missing" });
  });

  it("a trade with no account is compared to nothing", () => {
    expect(
      resolveFxRate({ quoteCurrency: "USD", accountCurrency: null }),
    ).toEqual({ rate: null, source: "no_account" });

    // The missing account is checked BEFORE the currencies match: with no
    // account there is nothing to match against, so 'same_currency' would not be
    // an answer here.
    expect(
      resolveFxRate({ quoteCurrency: "USD" }).source,
    ).toBe("no_account");
  });

  it("an unknown quote currency falls to missing, not to unity", () => {
    // An instrument that does not exist in the table has no quote_currency.
    // Matching undefined against 'USD' must not pass as 'same currency'.
    expect(
      resolveFxRate({ quoteCurrency: null, accountCurrency: "USD" }),
    ).toEqual({ rate: null, source: "missing" });
  });

  it("an invalid recorded rate is refused rather than used", () => {
    // The DB CHECK holds `fx_rate_at_trade > 0`, but this module also reads
    // values from the form, where there is no constraint yet. A zero would make
    // every division meaningless.
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        resolveFxRate({ snapshot: bad, quoteCurrency: "JPY", accountCurrency: "USD" }),
      ).toEqual({ rate: null, source: "missing" });
    }
  });
});

describe("fxRateNeedsAttention", () => {
  it("marks exactly the cases in which money cannot be displayed", () => {
    expect(fxRateNeedsAttention("missing")).toBe(true);
    expect(fxRateNeedsAttention("no_account")).toBe(true);
    expect(fxRateNeedsAttention("snapshot")).toBe(false);
    expect(fxRateNeedsAttention("same_currency")).toBe(false);
  });
});
