-- MAE/MFE comes back, and where it comes from depends on the account.
--
-- A BACKTEST account holds trades replayed on TradingView, years in the past.
-- Their extremes are filled from Dukascopy's historical 1-minute candles — the
-- only free source that was verified to carry XAUUSD, NAS100 and copper back to
-- 2018 (see FAZA_8B_PLAN.md). A TRADING account holds live FTMO trades, and
-- those will be filled from the broker's own MT5 terminal; until that exists,
-- nothing automatic touches them.
--
-- 1) `tj_accounts.account_kind` — set in Settings. 'trading' by default: an
--    account nobody said anything about is a real one, and the cautious reading
--    of a real account is "do not fill it from a third-party feed".
--
-- 2) `tj_positions.excursion_source` — who wrote the MAE/MFE prices. It left
--    with the bot bridge (20260918120000) and ROADMAP § Faza 8B said it would
--    have to come back with a source: MANUAL MUST WIN. The automatic fill writes
--    only where the prices are empty or were written automatically before, and
--    never over a value the trader typed.
--
--    Existing prices were all typed — nothing automatic has written them since
--    the bridge left — so they are marked 'manual' here, which protects them.

ALTER TABLE public.tj_accounts
  ADD COLUMN IF NOT EXISTS account_kind text NOT NULL DEFAULT 'trading';

ALTER TABLE public.tj_accounts DROP CONSTRAINT IF EXISTS tj_accounts_account_kind_check;
ALTER TABLE public.tj_accounts ADD CONSTRAINT tj_accounts_account_kind_check
  CHECK (account_kind = ANY (ARRAY['trading'::text, 'backtest'::text]));

COMMENT ON COLUMN public.tj_accounts.account_kind IS
  'trading = live account, MAE/MFE from MT5 (pending); backtest = replayed trades, '
  'MAE/MFE filled from Dukascopy 1-minute candles.';

ALTER TABLE public.tj_positions
  ADD COLUMN IF NOT EXISTS excursion_source text;

ALTER TABLE public.tj_positions DROP CONSTRAINT IF EXISTS tj_positions_excursion_source_check;
ALTER TABLE public.tj_positions ADD CONSTRAINT tj_positions_excursion_source_check
  CHECK (excursion_source IS NULL OR excursion_source = ANY (ARRAY[
    'manual'::text, 'dukascopy'::text, 'mt5'::text]));

COMMENT ON COLUMN public.tj_positions.excursion_source IS
  'Who wrote max_drawdown_price / max_profit_price: manual (typed — never '
  'overwritten), dukascopy (backtest accounts) or mt5 (trading accounts).';

UPDATE public.tj_positions
   SET excursion_source = 'manual'
 WHERE excursion_source IS NULL
   AND (max_drawdown_price IS NOT NULL OR max_profit_price IS NOT NULL);
