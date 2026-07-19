-- MAE / MFE excursion prices (filled at trade review/close).

ALTER TABLE public.tj_positions
  ADD COLUMN IF NOT EXISTS max_drawdown_price numeric,
  ADD COLUMN IF NOT EXISTS max_profit_price numeric;

COMMENT ON COLUMN public.tj_positions.max_drawdown_price IS
  'MAE: najnepovoljnija cena tokom trade-a (long=low, short=high)';
COMMENT ON COLUMN public.tj_positions.max_profit_price IS
  'MFE: najpovoljnija cena tokom trade-a (long=high, short=low)';
