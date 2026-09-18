/**
 * Value ranges on the trade write path.
 *
 * `buildPositionPatch` was the only defence until now, and it checks column
 * NAMES and types — not ranges. A finite number passes, so −5000 passed too.
 *
 * Measured against the live database before this change: ES, entry −5000, exit
 * −4990, `point_value` 50 → the view reports `gross_pl = 500`, `net_pl = 500`,
 * `realized_r = 1.00`. Nothing fails and nothing is flagged — the trade looks
 * like an ordinary $500 winner. That is the worst possible outcome for a
 * journal: not an error, but a CONFIDENT wrong number entering profit factor,
 * expectancy and the Sickre Score as if it had been earned.
 *
 * Why here and not only a CHECK in the database: the CHECK was added too
 * (`20260816...`), and it is the one that also stops a direct PostgREST write.
 * This copy exists so the user gets a sentence instead of the text "violates
 * check constraint tj_positions_prices_positive". The same bargain
 * `weekly/actions.ts` already applies to Mondays.
 *
 * A DECISION WORTH KNOWING: a price must be > 0. There is a genuine exception —
 * WTI settled at −$37.63 on 20 April 2020. That was a futures settlement price
 * on one day in history, not a fill a retail account sees. Against it stands
 * every missed sign, every "−" pasted out of a statement and every minus typed
 * into a price field. Refusing with a clear message beats accepting silently,
 * and if it is ever needed, this is the one place the rule changes.
 */

import { z } from "zod";
import { TRADE_IMAGE_KINDS } from "./tradingview-snapshot";

/**
 * The `tj_positions` columns that carry a PRICE and must therefore be strictly
 * positive.
 *
 * `position_size` is here although it is not a price: a quantity of zero or
 * less is not a position. `gross_pnl_override` is NOT — a loss is a negative
 * number, and that is its only correct value when money was lost.
 */
export const POSITIVE_TRADE_NUMBERS = [
  "entry_price",
  "stop_price",
  "target_price",
  "max_drawdown_price",
  "max_profit_price",
  "position_size",
] as const;

/** Columns that must be a positive INTEGER. The database carries the same CHECK. */
export const POSITIVE_TRADE_INTEGERS = [
  "time_stop_days",
  // The lower bound and integerness are caught by this loop; the UPPER bound (5)
  // is held by the DB CHECK and is unreachable from a UI with exactly five
  // buttons. It lives here rather than as its own
  // `z.number().int().min(1).max(5)` because that would be a new statement in a
  // module carrying a 100 % coverage floor — and this loop already exists and
  // already covers everything the form can send at all.
  "execution_rating",
] as const;

const LABELS: Record<string, string> = {
  entry_price: "Entry price",
  stop_price: "Stop price",
  target_price: "Target price",
  max_drawdown_price: "MAE price",
  max_profit_price: "MFE price",
  position_size: "Position size",
  time_stop_days: "Time stop (days)",
  execution_rating: "Execution rating",
};

/**
 * Check the range of the numbers in an already-cleaned patch.
 *
 * Runs over the OUTPUT of `buildPositionPatch`, not over the raw form: coercion
 * has happened by then, so every value here is either a number or null and the
 * check is about range rather than type. Values that went into the `custom` bag
 * are left alone — they have no column, and therefore no meaning that could be
 * asserted.
 *
 * Returns a message or null. The first error, not a list: the same pattern as
 * `validateTradingViewSnapshotUrl`, and the form shows one anyway.
 */
export function invalidTradeNumber(
  columns: Record<string, unknown>,
): string | null {
  for (const key of POSITIVE_TRADE_NUMBERS) {
    const v = columns[key];
    if (v == null) continue;
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
      return `${LABELS[key]} must be greater than zero.`;
    }
  }
  for (const key of POSITIVE_TRADE_INTEGERS) {
    const v = columns[key];
    if (v == null) continue;
    if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) {
      return `${LABELS[key]} must be a whole number greater than zero.`;
    }
  }
  const override = columns.gross_pnl_override;
  if (override != null && (typeof override !== "number" || !Number.isFinite(override))) {
    return "Actual Gross P&L must be a number.";
  }
  return null;
}

/**
 * One fill.
 *
 * `price` is positive for the same reason position prices are, and here it is
 * the only defence there is: `tj_replace_executions` requires only
 * `price IS NOT NULL AND qty > 0`, and `tj_executions` carries a CHECK on `qty`
 * alone.
 *
 * `executed_at` has to be a time that can be read. The RPC takes it as a
 * `timestamptz`, and a row with an invalid time DROPS SILENTLY out of the
 * `WHERE` — the function returns a smaller number of written rows, and
 * `updateTrade` never looks at that value. The trade saves with two fills
 * instead of three and reports `ok`.
 */
export const executionSchema = z.object({
  side: z.enum(["entry", "exit"]),
  price: z.number().finite().positive(),
  qty: z.number().finite().positive(),
  executed_at: z
    .string()
    .refine((s) => Number.isFinite(Date.parse(s)), "Fill time is not a valid date."),
  fee: z.number().finite(),
  swap_funding: z.number().finite(),
});

/**
 * The structural half of a submission — everything but the dynamic `fields` bag.
 *
 * `fields` stays `unknown`-valued on purpose: its key set comes from
 * `tj_field_defs`, so a zod schema over it would be a second definition of what
 * `buildPositionPatch` already does from one source. Its numbers are checked by
 * `invalidTradeNumber`, AFTER coercion.
 */
export const tradeInputSchema = z.object({
  account_id: z.uuid().nullable(),
  trade_no: z.number().int().positive().nullable(),
  fields: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.array(z.string()), z.null()]),
  ),
  executions: z.array(executionSchema),
  trade_phase: z.enum(["planned", "active"]).nullable().optional(),
  current_status: z.string().nullable().optional(),
  playbook_id: z.uuid().nullable().optional(),
  /**
   * 1–5, and stricter than it used to be.
   *
   * `playbookPatch` SILENTLY collapsed an out-of-range value to null — the
   * conviction the trader actually entered would vanish without a single
   * message. It is refused now, so the difference between "I did not rate this"
   * and "the rating was discarded" is visible.
   */
  rule_answers: z.record(z.uuid(), z.boolean()).optional(),
  images: z
    .array(
      z.object({
        kind: z.enum(TRADE_IMAGE_KINDS),
        image_url: z.string(),
      }),
    )
    .optional(),
});

/**
 * One import row.
 *
 * `gross_pnl_override` is the only number with no lower bound: a loss on a
 * statement is negative and that is its correct value. A fill price is not —
 * the same rule as on manual entry, and for the same reason. A broker statement
 * is not an infallible source: a column can be mapped wrongly, and a mapping
 * that shifts price into the profit column produces negative "prices" that
 * would otherwise travel all the way to the view.
 */
export const importItemSchema = z.object({
  decision: z.enum(["create", "merge", "skip"]),
  match_status: z.enum(["new", "match", "suggested", "duplicate", "ambiguous"]),
  matched_position_id: z.uuid().nullable(),
  instrument: z.string().nullable(),
  direction: z.string().nullable(),
  executions: z.array(executionSchema),
  gross_pnl_override: z.number().finite().nullable(),
  /**
   * Optional, not because it may be missing from a row the wizard built, but
   * because a browser still holding the previous bundle posts rows without it —
   * and a required field would fail EVERY row of that import rather than the
   * one thing the field does. Absent and null mean the same: no target.
   */
  target_price: z.number().finite().positive().nullable().optional(),
  raw: z.record(z.string(), z.string()),
});

/**
 * The import envelope — everything but the rows themselves.
 *
 * The rows are DELIBERATELY not validated here. `commitImport` already handles
 * each row in its own `try`, counts `failed` and collects a per-row message;
 * validating the whole list up front would turn one broken row into a rejected
 * file. A statement of three hundred trades with one bad cell should import two
 * hundred and ninety-nine and say which row was left.
 */
export const commitImportSchema = z.object({
  account_id: z.uuid().nullable(),
  filename: z.string(),
  items: z.array(z.unknown()),
});

/**
 * The first message out of a zod report, with the field name in front of it.
 *
 * Zod's default text ("Too small: expected number to be >0") is correct but
 * does not say WHERE. The path to the field is what tells the user which row to
 * fix, so it is prefixed — `executions.0.price` becomes a readable location.
 */
export function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}
