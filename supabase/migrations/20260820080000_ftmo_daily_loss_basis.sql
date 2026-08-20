-- Per-account choice of what the FTMO daily-loss limit is a percentage OF.
--
-- 'starting_balance' (default, existing behavior): the limit is fixed for the
-- life of the challenge — matches FTMO's 2-Step account.
-- 'prev_close': the limit resets each day to a percentage of the PREVIOUS
-- trading day's closing equity — matches FTMO's 1-Step / trailing-style
-- account. Which one applies depends on the challenge type the trader bought,
-- so this is a setting, not a fixed choice.
--
-- Additive & defaulted so existing accounts keep today's (starting_balance)
-- behavior unchanged.

ALTER TABLE public.tj_accounts
  ADD COLUMN IF NOT EXISTS ftmo_daily_loss_basis text NOT NULL DEFAULT 'starting_balance'
    CHECK (ftmo_daily_loss_basis IN ('starting_balance', 'prev_close'));
