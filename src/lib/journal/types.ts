// Client-safe shared types (no server-only imports here).

import type { Database } from "@/lib/supabase/types";
import type {
  CategorySelection,
  FieldDefPhase,
} from "./field-def-types";

export type OptionItem = {
  id: string;
  value: string;
  label: string;
  color: string | null;
  /**
   * One-line explanation shown under the item. Null means "no line of its own"
   * — playbook sections then fall back to the built-in hint for the values this
   * repo seeds, and show nothing for a section the trader invented.
   */
  description: string | null;
  is_active: boolean;
  sort_order: number;
};

export type OptionList = {
  id: string;
  key: string;
  label: string;
  category: string | null;
  /** Hex colour for the category chip; null when none was chosen. */
  color: string | null;
  /**
   * Which phase of a trade asks for this category, joined from the field that
   * renders it.
   *
   * `null` when NO field def reads the list, and that is a real distinction
   * rather than a missing value: those categories are wired into the form by
   * code — `exit_reason` on the outcome block, `miss_reason` only on a missed
   * setup. Their place is behaviour, not a setting, and offering a phase
   * picker for them would be a control that silently does nothing.
   */
  show_phase: FieldDefPhase | null;
  /**
   * One tag at a time, or several — `null` for the same reason `show_phase` is:
   * no field def reads the list, so the form's own picker decides.
   */
  selection: CategorySelection | null;
  sort_order: number;
  items: OptionItem[];
};

export type OptionsMap = Record<string, OptionItem[]>;

export type Instrument = {
  id: string;
  symbol: string;
  name: string | null;
  asset_class: string | null;
  point_value: number;
  tick_size: number | null;
  tick_value: number | null;
  /** The currency the instrument is QUOTED in — the currency of `point_value`, and so of gross P&L before conversion. */
  quote_currency: string;
  /**
   * What the broker charges on THIS instrument, per side and per night.
   *
   * On the instrument rather than the account because one book is charged
   * three ways: a fee per lot on FX, a share of notional on the metals, and
   * nothing on the index. `instrument-costs.ts` does the arithmetic.
   */
  commission_per_lot: number;
  commission_pct: number;
  commission_currency: string;
  is_active: boolean;
  sort_order: number;
};

export type Account = {
  id: string;
  name: string;
  broker: string | null;
  currency: string;
  starting_balance: number;
  default_asset_class: string | null;
  timezone: string;
  /** The default account. Not "archived" — that is `archived_at`. */
  is_active: boolean;
  /**
   * When the account was archived, or null. An archived account is left out of
   * every picker and default; its trades still count in every scope.
   */
  archived_at: string | null;
  created_at: string;
  // Breakeven band — asymmetric on purpose (e.g. -37.50 .. 0), not a tolerance.
  breakeven_from: number;
  breakeven_to: number;
  breakeven_unit: "currency" | "pct";
  // Cost defaults applied to new execution rows in the trade form.
  default_commission_per_unit: number;
  default_fee_fixed: number;
  // Risk plan defaults applied when stop / target are left empty.
  default_stop_pct: number | null;
  default_target_pct: number | null;
  // Topstep futures account (per account). See topstep.ts.
  topstep_mode: boolean;
  topstep_plan: "50K" | "100K" | "150K";
  /** First payout: from then on the MLL floor is the starting balance (Topstep's "$0"). */
  topstep_payout_at: string | null;
  topstep_reset_at: string | null;
  /**
   * TopstepX's Personal Daily Loss Limit and Personal Daily Profit Target, in
   * money; null = not set (the plan's DLL, no target). `topstep.ts` reads both.
   */
  topstep_personal_dll: number | null;
  topstep_daily_target: number | null;
  /**
   * Combine, Express Funded Account or Practice (phase T): the XFA sizes by the Scaling Plan and pays
   * out by path; Practice keeps a Combine's rules, passes nothing and is kept apart from the real book.
   */
  topstep_stage: "combine" | "xfa" | "practice";
  /** Risk per trade as a share of the room above the MLL, in %. */
  risk_rule_pct: number;
  /** Risk-per-trade bounds in money; null = the plan's own (topstep.ts `TOPSTEP_PLANS`). */
  risk_rule_min: number | null;
  risk_rule_max: number | null;
};

/** Where `point_value` came from. `missing` means the money columns are null. */
export const POINT_VALUE_SOURCES = ["snapshot", "instrument", "missing"] as const;
export type PointValueSource = (typeof POINT_VALUE_SOURCES)[number];

/**
 * Where the rate came from. `missing` and `no_account` mean the money columns
 * are null — the same rule as `point_value_source`, and for the same reason:
 * better nothing than a yen added to a dollar.
 */
export const FX_RATE_SOURCES = [
  "snapshot",
  "same_currency",
  "no_account",
  "missing",
] as const;
export type FxRateSource = (typeof FX_RATE_SOURCES)[number];

type StatsViewRow = Database["public"]["Views"]["tj_position_stats"]["Row"];

/**
 * One `tj_position_stats` row — DERIVED from the generated type, not transcribed.
 *
 * This used to be a hand-written list of 22 fields against the view's 29
 * columns, which made `statRows as PositionStat[]` in `trades.ts` an assertion
 * nothing checked: seven columns (`user_id`, `account_id`, `instrument`,
 * `direction`, `status`, `dir_mult`, `gross_points`) the type did not even know
 * about, while `position_id` and the two `*_source` fields were narrowed to
 * non-null even though PostgREST guarantees nothing for a view.
 *
 * Now a change to the view changes this type too. A column that disappears or
 * changes type fails the typecheck here — exactly what a hand-written list
 * could not do.
 *
 * `Pick`, not the whole row: the view also carries `user_id`, `account_id`,
 * `instrument`, `direction`, `status`, `dir_mult` and `gross_points`, which the
 * application reads off THE POSITION ITSELF rather than from here (verified by
 * grep — nothing touches `stats.instrument` or the others). A projection is
 * more honest than an `Omit`: it states what is actually consumed, and a new
 * column in the view does not become an obligation for every fixture that will
 * never read it.
 *
 * Three narrowings remain, and they are the only three:
 *   • `position_id` is `p.id`, the primary key — never null in practice;
 *   • the two `*_source` fields are a `CASE` with an `ELSE` arm, so they always
 *     return a value.
 * `narrowPositionStat` checks them at runtime, and not blindly.
 */
export type PositionStat = Pick<
  StatsViewRow,
  | "avg_entry"
  | "avg_exit"
  | "entry_qty"
  | "exit_qty"
  | "gross_pl"
  | "net_pl"
  | "total_fees"
  | "realized_r"
  | "realized_r_net"
  | "opened_at"
  | "closed_at"
  | "duration_seconds"
  | "point_value"
  | "tick_size"
  | "quote_currency"
  | "account_currency"
  | "fx_rate"
  | "money_overridden"
> & {
  position_id: string;
  point_value_source: PointValueSource;
  fx_rate_source: FxRateSource;
};

/**
 * Narrow one view row into a `PositionStat`, or reject a row with no
 * `position_id`.
 *
 * An unknown value in a `*_source` field falls back to `"missing"` — leaning
 * deliberately towards CAUTION: `missing` is the label that says "the money
 * here is not trustworthy", so an unknown state reads as unvalued rather than
 * being quietly accepted as recorded. The opposite choice would present a value
 * of unknown provenance as a verified one.
 */
export function narrowPositionStat(row: StatsViewRow): PositionStat | null {
  if (!row.position_id) return null;
  return {
    ...row,
    position_id: row.position_id,
    point_value_source: (POINT_VALUE_SOURCES as readonly string[]).includes(
      row.point_value_source ?? "",
    )
      ? (row.point_value_source as PointValueSource)
      : "missing",
    fx_rate_source: (FX_RATE_SOURCES as readonly string[]).includes(
      row.fx_rate_source ?? "",
    )
      ? (row.fx_rate_source as FxRateSource)
      : "missing",
  };
}

export type TradeRow = {
  id: string;
  account_id: string | null;
  trade_no: number | null;
  status: string;
  source: string;
  needs_review: boolean;
  created_at: string;
  stats: PositionStat | null;
  /** The trade's chart images, in the order they were added. */
  chart_images?: string[];
} & Record<string, unknown>;
