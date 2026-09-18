import { describe, expect, it } from "vitest";
import {
  commitImportSchema,
  executionSchema,
  firstIssue,
  importItemSchema,
  invalidTradeNumber,
  tradeInputSchema,
} from "./trade-input-schema";
import { buildPositionPatch } from "./trade-fields";
import { computePositionStats } from "./position-stats";

/**
 * RANGES ON THE WRITE PATH.
 *
 * Until Step 6 the only defence was `buildPositionPatch`, which checks column
 * NAMES and types. A finite number passed regardless of its sign.
 *
 * This file opens by demonstrating the consequence — with the same numbers
 * measured against the live database — and only then asserts that they are
 * refused. The order is deliberate: without the first test the second looks
 * like arbitrary strictness.
 */

const UUID = "3c5e07a9-8ad8-4e06-9343-60c316d4520f";

describe("why at all: a negative price produces a convincingly wrong number", () => {
  it("a missed sign prints as a healthy winner, not as an error", () => {
    // The same thing measured in the database before the fix: ES, entry −5000,
    // exit −4990, point_value 50 → gross_pl 500, realized_r 1.00. Nothing
    // fails.
    const stats = computePositionStats({
      direction: "Long",
      entry_price: -5000,
      stop_price: -5010,
      point_value: 50,
      fx_rate: 1,
      executions: [
        { side: "entry", price: -5000, qty: 1 },
        { side: "exit", price: -4990, qty: 1 },
      ],
    });
    expect(stats.gross_pl).toBeCloseTo(500, 10);
    expect(stats.realized_r).toBeCloseTo(1, 10);
    // There is no flag anywhere saying something is suspicious — which is why
    // the check has to stand BEFORE this, at the input.
  });
});

describe("prices on a position", () => {
  const patchOf = (fields: Record<string, string | number | null>) =>
    buildPositionPatch(fields).columns;

  it("negative and zero prices are refused, with a message that names the field", () => {
    for (const key of [
      "entry_price",
      "stop_price",
      "target_price",
      "max_drawdown_price",
      "max_profit_price",
      "position_size",
    ]) {
      expect(invalidTradeNumber(patchOf({ [key]: -1 })), key).toBeTruthy();
      expect(invalidTradeNumber(patchOf({ [key]: 0 })), key).toBeTruthy();
      expect(invalidTradeNumber(patchOf({ [key]: 5000 })), key).toBeNull();
    }
  });

  it("the message says which field, not merely that something is wrong", () => {
    expect(invalidTradeNumber(patchOf({ stop_price: -1 }))).toBe(
      "Stop price must be greater than zero.",
    );
  });

  it("a field that was not sent is not checked", () => {
    // Editing one field must not require every other field to be filled in.
    expect(invalidTradeNumber({})).toBeNull();
    expect(invalidTradeNumber({ entry_price: null })).toBeNull();
  });

  it("a loss in `gross_pnl_override` PASSES — that is a valid value for it", () => {
    // The only number on a trade allowed to be negative. Give it a bound too
    // and the journal could not record a loss off a statement.
    expect(invalidTradeNumber({ gross_pnl_override: -250 })).toBeNull();
    expect(invalidTradeNumber({ gross_pnl_override: 0 })).toBeNull();
  });

  it("but a `gross_pnl_override` that is not a number still fails", () => {
    // Unreachable through the form: `buildPositionPatch` already collapses a
    // `number` field to a number or null. The check stands because the function
    // is a boundary taking a plain object, and because the RESULT is the one
    // column the view takes on trust — when it is set, it bypasses both the
    // contract spec and the rate.
    expect(invalidTradeNumber({ gross_pnl_override: "sto dolara" })).toBe(
      "Actual Gross P&L must be a number.",
    );
    expect(invalidTradeNumber({ gross_pnl_override: Number.NaN })).toBeTruthy();
  });

  it("time_stop_days has to be an integer greater than zero", () => {
    expect(invalidTradeNumber({ time_stop_days: 0 })).toBeTruthy();
    expect(invalidTradeNumber({ time_stop_days: -3 })).toBeTruthy();
    expect(invalidTradeNumber({ time_stop_days: 2.5 })).toBeTruthy();
    expect(invalidTradeNumber({ time_stop_days: 3 })).toBeNull();
  });

  it("execution_rating has to be an integer greater than zero", () => {
    // Zero and half a star are not ratings. The upper bound (5) is held by the
    // DB CHECK and is unreachable from a UI with exactly five buttons, so it is
    // not proven here.
    expect(invalidTradeNumber({ execution_rating: 0 })).toBeTruthy();
    expect(invalidTradeNumber({ execution_rating: 2.5 })).toBeTruthy();
    expect(invalidTradeNumber({ execution_rating: 4 })).toBeNull();
    // NULL is legitimate and common: "not rated" is not an error.
    expect(invalidTradeNumber({ execution_rating: null })).toBeNull();
  });
});

describe("fill", () => {
  const fill = (over: Record<string, unknown> = {}) => ({
    side: "entry",
    price: 5000,
    qty: 1,
    executed_at: "2026-03-02T14:00:00Z",
    fee: 0,
    swap_funding: 0,
    ...over,
  });

  it("a price has to be positive", () => {
    expect(executionSchema.safeParse(fill()).success).toBe(true);
    expect(executionSchema.safeParse(fill({ price: -5000 })).success).toBe(false);
    expect(executionSchema.safeParse(fill({ price: 0 })).success).toBe(false);
  });

  it("an invalid time is REFUSED rather than letting the row drop silently", () => {
    // `tj_replace_executions` used to drop a row with an invalid `executed_at`
    // through its WHERE and return a smaller written count — and `updateTrade`
    // never looked at that value. The trade would save with two fills instead
    // of three and report `ok`.
    expect(executionSchema.safeParse(fill({ executed_at: "juče" })).success).toBe(
      false,
    );
  });

  it("commission and swap may be negative — a rebate is real", () => {
    expect(executionSchema.safeParse(fill({ fee: -0.25 })).success).toBe(true);
  });
});

describe("struktura submisije", () => {
  const input = (over: Record<string, unknown> = {}) => ({
    account_id: UUID,
    trade_no: null,
    fields: {},
    executions: [],
    ...over,
  });

  it("an account_id that is not a uuid fails here, not in Postgres", () => {
    expect(tradeInputSchema.safeParse(input()).success).toBe(true);
    expect(tradeInputSchema.safeParse(input({ account_id: "prvi" })).success).toBe(
      false,
    );
    expect(tradeInputSchema.safeParse(input({ account_id: null })).success).toBe(
      true,
    );
  });

  it("conviction no longer exists as a field and never reaches the database", () => {
    // The 1–5 pre-entry rating was removed: the same setup scored a 3 one day
    // and a 5 the next, so grouping a report by it measured mood rather than
    // the trade. The schema is not `.strict()`, so an older client still
    // sending it gets no error — the value simply falls out of the parsed
    // result and is never written.
    const parsed = tradeInputSchema.safeParse(input({ conviction: 3 }));
    expect(parsed.success).toBe(true);
    expect(parsed.data).not.toHaveProperty("conviction");
  });

  it("trade_no is a positive integer or null", () => {
    expect(tradeInputSchema.safeParse(input({ trade_no: 7 })).success).toBe(true);
    expect(tradeInputSchema.safeParse(input({ trade_no: 0 })).success).toBe(false);
    expect(tradeInputSchema.safeParse(input({ trade_no: -2 })).success).toBe(false);
  });

  it("nepoznat slot za grafik ne prolazi", () => {
    expect(
      tradeInputSchema.safeParse(
        input({ images: [{ kind: "htf_pre", image_url: "x" }] }),
      ).success,
    ).toBe(true);
    expect(
      tradeInputSchema.safeParse(
        input({ images: [{ kind: "izmisljen", image_url: "x" }] }),
      ).success,
    ).toBe(false);
  });

  it("the message carries the path to the field", () => {
    const res = tradeInputSchema.safeParse(
      input({ executions: [{ side: "entry", price: -1, qty: 1, executed_at: "2026-03-02T14:00:00Z", fee: 0, swap_funding: 0 }] }),
    );
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(firstIssue(res.error)).toContain("executions.0.price");
    }
  });
});

describe("uvoz", () => {
  it("the envelope is validated, the rows are NOT validated up front", () => {
    // Deliberate: one broken row must not reject a file of three hundred
    // trades. The rows are validated by `commitImport` in a loop, where each
    // has its own `try`.
    const withBadRow = {
      account_id: UUID,
      filename: "izvod.csv",
      items: [{ ovo: "nije red uvoza" }],
    };
    expect(commitImportSchema.safeParse(withBadRow).success).toBe(true);
    expect(
      commitImportSchema.safeParse({ ...withBadRow, account_id: "nije-uuid" })
        .success,
    ).toBe(false);
  });

  it("a row with a negative price fails — a wrongly mapped column", () => {
    // A mapping that drops profit into the price column produces negative
    // "prices". A statement is not an infallible source; the only infallible
    // thing is a mapping nobody has checked.
    const row = {
      decision: "create",
      match_status: "new",
      matched_position_id: null,
      instrument: "ES",
      direction: "Long",
      gross_pnl_override: -250,
      raw: { Symbol: "ES" },
      executions: [
        {
          side: "entry",
          price: -5000,
          qty: 1,
          executed_at: "2026-03-02T14:00:00Z",
          fee: 0,
          swap_funding: 0,
        },
      ],
    };
    expect(importItemSchema.safeParse(row).success).toBe(false);
    expect(
      importItemSchema.safeParse({
        ...row,
        executions: [{ ...row.executions[0], price: 5000 }],
      }).success,
    ).toBe(true);
  });
});

describe("the target an import may fill in", () => {
  const row = {
    decision: "create" as const,
    match_status: "suggested" as const,
    matched_position_id: null,
    instrument: "ES",
    direction: "Long",
    gross_pnl_override: null,
    raw: { Symbol: "ES" },
    executions: [
      {
        side: "entry" as const,
        price: 5000,
        qty: 1,
        executed_at: "2026-03-02T14:00:00Z",
        fee: 0,
        swap_funding: 0,
      },
    ],
  };

  it("accepts a price, a null, and a row that does not mention it at all", () => {
    // The third case is a browser on the previous bundle: absent must not fail
    // the row, or a stale tab breaks the whole import rather than one field.
    expect(importItemSchema.safeParse({ ...row, target_price: 5100 }).success).toBe(true);
    expect(importItemSchema.safeParse({ ...row, target_price: null }).success).toBe(true);
    expect(importItemSchema.safeParse(row).success).toBe(true);
  });

  it("refuses a target that is not a price — the same trap as a negative fill", () => {
    expect(importItemSchema.safeParse({ ...row, target_price: 0 }).success).toBe(false);
    expect(importItemSchema.safeParse({ ...row, target_price: -1 }).success).toBe(false);
  });

  it("knows 'suggested' — a match made without the time", () => {
    expect(importItemSchema.safeParse({ ...row, match_status: "suggested" }).success).toBe(true);
    expect(importItemSchema.safeParse({ ...row, match_status: "invented" }).success).toBe(false);
  });
});
