-- Accounts can be archived.
--
-- A trader running many FTMO challenges ends up with accounts that are finished
-- but whose trades must keep counting in "All" and in the Live / Backtest
-- scopes. Deleting them destroys that history; keeping them clutters every
-- picker. `archived_at` hides an account from the pickers and defaults (trade
-- form, import, reports, dashboard filter, cash entry) while its trades stay.
--
-- `is_active` keeps its existing meaning — the default account — and is not
-- reused for this: an archived account is not "inactive", it is finished.

ALTER TABLE public.tj_accounts
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

COMMENT ON COLUMN public.tj_accounts.archived_at IS
  'When the account was archived. Archived accounts are hidden from pickers and defaults; their trades still count in every scope that includes them.';
