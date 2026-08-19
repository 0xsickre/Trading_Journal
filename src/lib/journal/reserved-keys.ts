/**
 * Imena kolona na `tj_positions`. Korisničko polje ne sme da uzme nijedno.
 *
 * `fieldValue` čita kolone PRE `custom` bag-a, pa bi polje sa istim ključem bilo
 * upisano u bag a pročitano iz kolone — trajno nevidljivo. DB CHECK na
 * `tj_field_defs.key` proverava samo OBLIK ključa, ne i koliziju, pa je ovo
 * jedina odbrana.
 *
 * Izdvojeno iz `settings/actions.ts` da bi moglo da se testira. Lista je već
 * dvaput odlutala od šeme: propustila je `thesis`, `invalidation`,
 * `time_stop_days` i `scale_out_plan` (dodate 13.08.), pa zatim
 * `quote_currency_at_trade`, `fx_rate_at_trade` i `gross_pnl_override` (15.08.).
 * `reserved-keys.test.ts` sada čita kolone iz generisanog `types.ts` i pada ako
 * lista opet zaostane za migracijom.
 */
export const RESERVED_KEYS = new Set([
  "id",
  "user_id",
  "account_id",
  "trade_no",
  "status",
  "source",
  "custom",
  "created_at",
  "updated_at",
  "instrument",
  "direction",
  "entry_price",
  "stop_price",
  "target_price",
  "risk_pct",
  "planned_rr",
  "position_size",
  "setup_grade",
  "technical_tags",
  "psychology_tags",
  "exit_reason",
  "mistake",
  "miss_reason",
  "missed_at",
  "max_drawdown_price",
  "max_profit_price",
  "trade_journal_notes",
  "needs_review",
  "playbook_id",
  "conviction",
  "execution_rating",
  "import_batch_id",
  "point_value_at_trade",
  "tick_size_at_trade",
  "quote_currency_at_trade",
  "fx_rate_at_trade",
  "gross_pnl_override",
  "thesis",
  "invalidation",
  "time_stop_days",
  "scale_out_plan",
]);
