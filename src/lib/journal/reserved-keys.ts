/**
 * The column names on `tj_positions`. A custom field may take none of them.
 *
 * `fieldValue` reads columns BEFORE the `custom` bag, so a field with a
 * colliding key would be written into the bag and read out of the column —
 * permanently invisible. The DB CHECK on `tj_field_defs.key` validates only the
 * SHAPE of the key, not collisions, so this is the only defence.
 *
 * Extracted out of `settings/actions.ts` so it could be tested. The list has
 * already drifted from the schema twice: it missed `thesis`, `invalidation`,
 * `time_stop_days` and `scale_out_plan` (added 13 Aug), and then
 * `quote_currency_at_trade`, `fx_rate_at_trade` and `gross_pnl_override`
 * (15 Aug). `reserved-keys.test.ts` now reads the columns out of the generated
 * `types.ts` and fails when the list falls behind a migration again — and it
 * has failed twice: on the `broker*` columns and on `excursion_source`
 * (21 Aug), both times before anyone had made a field that would have masked
 * them. Both of those columns went again with the bot bridge
 * (20260918120000_remove_bot_bridge.sql), and the test is why this list shrank
 * with them instead of keeping names the schema no longer has.
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
  "scale_out_levels",
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
  "excursion_source",
  "equity_at_entry",
]);
