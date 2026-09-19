-- MAE/MFE on BACKTEST accounts is typed by hand again; Dukascopy is gone.
--
-- The automatic backtest fill (20260919100000) had to guess the difference
-- between a third-party feed and the broker the trades were replayed on, and on
-- copper that guess refused more trades than it filled. The trader types
-- backtest extremes; only TRADING accounts are filled automatically, from the
-- broker's own MT5 terminal (`scripts/mt5_excursion.py`).
--
-- The one trade the feed wrote keeps its prices, now as the trader's: they sit
-- in the journal, and a value nobody can recompute any more is a typed one.

UPDATE public.tj_positions
   SET excursion_source = 'manual'
 WHERE excursion_source = 'dukascopy';

ALTER TABLE public.tj_positions DROP CONSTRAINT IF EXISTS tj_positions_excursion_source_check;
ALTER TABLE public.tj_positions ADD CONSTRAINT tj_positions_excursion_source_check
  CHECK (excursion_source IS NULL OR excursion_source = ANY (ARRAY['manual'::text, 'mt5'::text]));

COMMENT ON COLUMN public.tj_positions.excursion_source IS
  'Who wrote max_drawdown_price / max_profit_price: manual (typed — never '
  'overwritten) or mt5 (trading accounts, scripts/mt5_excursion.py).';

COMMENT ON COLUMN public.tj_accounts.account_kind IS
  'trading = live account, MAE/MFE filled from MT5; backtest = replayed trades, '
  'MAE/MFE typed by hand.';
