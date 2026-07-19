-- FTMO / prop-firm challenge mode, per account. Additive & nullable/defaulted so
-- existing accounts are unaffected (mode off by default). Rules are evaluated live
-- in the app from realized trades; only config + the reset marker live here.

ALTER TABLE public.tj_accounts
  ADD COLUMN IF NOT EXISTS ftmo_mode boolean NOT NULL DEFAULT false,
  -- Max daily loss (% of starting balance, resets each day)
  ADD COLUMN IF NOT EXISTS ftmo_daily_loss_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ftmo_daily_loss_pct numeric NOT NULL DEFAULT 5,
  -- Max total loss / static drawdown (% of starting balance)
  ADD COLUMN IF NOT EXISTS ftmo_max_loss_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ftmo_max_loss_pct numeric NOT NULL DEFAULT 10,
  -- Profit target (% of starting balance)
  ADD COLUMN IF NOT EXISTS ftmo_profit_target_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ftmo_profit_target_pct numeric NOT NULL DEFAULT 10,
  -- Minimum trading days
  ADD COLUMN IF NOT EXISTS ftmo_min_days_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ftmo_min_days integer NOT NULL DEFAULT 4,
  -- Challenge start marker: trades before this are ignored (set on "reset").
  ADD COLUMN IF NOT EXISTS ftmo_reset_at timestamptz;
