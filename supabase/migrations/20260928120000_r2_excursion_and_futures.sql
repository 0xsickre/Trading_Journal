-- Topstep futures join the book, and their MAE/MFE comes from one price source.
--
-- Trading moves from FTMO CFDs to CME futures on Topstep (NQ, MNQ, ES, MES, 6E,
-- M6E). Their MAE/MFE is written by `tools/journal_mae.py` in the futures-trading
-- repo, from the exchange's own candles kept in Cloudflare R2 — one source for
-- every futures trade, however it reached the journal (TopstepX import, typed,
-- TradingView replay).
--
-- 1) `excursion_source = 'r2'`. On a FUTURE, R2 wins over a typed value: the
--    trader decided on 28.09.2026 that one price source beats two, and the
--    exchange's prices are the record the fills were made against. The fill
--    refuses a trade rather than guess — every fill must lie inside its own
--    candle of the contract it names, or the trade is left alone with a reason
--    printed. CFDs keep the old rule (typed wins; MT5 fills the rest).
--
-- 2) `excursion_note` — which contract and resolution the value was read off,
--    e.g. "MNQZ6 · 1s". A number nobody can trace back to its candles is one
--    nobody can check.
--
-- 3) The catalog seed learns the six futures, and every existing book gets them
--    once, alongside what it has. `on conflict do nothing`: nothing the trader
--    already holds under these symbols is touched, and no other row is.

ALTER TABLE public.tj_positions DROP CONSTRAINT IF EXISTS tj_positions_excursion_source_check;
ALTER TABLE public.tj_positions ADD CONSTRAINT tj_positions_excursion_source_check
  CHECK (excursion_source IS NULL OR excursion_source = ANY (ARRAY[
    'manual'::text, 'mt5'::text, 'tradingview'::text, 'r2'::text]));

ALTER TABLE public.tj_positions
  ADD COLUMN IF NOT EXISTS excursion_note text;

COMMENT ON COLUMN public.tj_positions.excursion_source IS
  'Who wrote max_drawdown_price / max_profit_price: manual (typed), mt5 (CFD '
  'trading accounts, scripts/mt5_excursion.py), tradingview (the TradingView '
  'import) or r2 (futures, futures-trading tools/journal_mae.py, from exchange '
  'candles in Cloudflare R2). Typed wins on a CFD; on a future r2 wins.';

COMMENT ON COLUMN public.tj_positions.excursion_note IS
  'Where an automatic MAE/MFE was read: contract and resolution, e.g. '
  '"MNQZ6 · 1s". Null when typed.';

create or replace function public.tj_seed_instruments_defaults(target uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  -- Only ever for an empty book. Re-running this must not resurrect a symbol
  -- the trader deleted, which is what `20260920001500` was written to stop.
  if exists (select 1 from public.tj_instruments where user_id = target) then
    return;
  end if;

  insert into public.tj_instruments (
    user_id, symbol, name, asset_class,
    point_value, tick_size, tick_value, quote_currency,
    commission_per_lot, commission_pct, commission_currency,
    swap_long, swap_short, swap_triple_day,
    is_active, sort_order
  )
  select target, v.symbol, v.name, v.asset_class,
         v.point_value, v.tick_size, null::numeric, v.quote_currency,
         v.commission_per_lot, v.commission_pct, v.commission_currency,
         v.swap_long, v.swap_short, v.swap_triple_day,
         true, v.ord
  from (values
    ('EURUSD','Euro / US Dollar','Forex',100000::numeric,0.00001::numeric,'USD',2.5::numeric,0::numeric,'USD',-11.06::numeric,0.59::numeric,3::smallint,0),
    ('GBPUSD','Pound / US Dollar','Forex',100000,0.00001,'USD',2.5,0,'USD',-6.78,-3.76,3,1),
    ('AUDUSD','Aussie / US Dollar','Forex',100000,0.00001,'USD',2.5,0,'USD',-3.92,-5.11,3,2),
    ('NZDUSD','Kiwi / US Dollar','Forex',100000,0.00001,'USD',2.5,0,'USD',-5.3,-0.17,3,3),
    ('USDCAD','US Dollar / Canadian Dollar','Forex',100000,0.00001,'CAD',2.5,0,'USD',1.42,-14.45,3,4),
    ('USDCHF','US Dollar / Swiss Franc','Forex',100000,0.00001,'CHF',2.5,0,'USD',2.55,-16.95,3,5),
    ('USDJPY','US Dollar / Yen','Forex',100000,0.001,'JPY',2.5,0,'USD',4.8,-23.65,3,6),
    ('XAUUSD','Gold / US Dollar (spot CFD)','Metals CFD',100,0.01,'USD',0,0.0007,'EUR',-83,-8.3,3,10),
    ('XCUUSD','Copper / US Dollar (spot CFD)','Metals CFD',100,0.01,'USD',0,0.0007,'EUR',-17.93,2.57,3,11),
    ('US100.cash','Nasdaq 100 (spot CFD)','Index CFD',1,0.01,'USD',0,0,'USD',-634.31,27.37,5,20),
    ('NQ','E-mini Nasdaq 100','Futures',20,0.25,'USD',1.89,0,'USD',0,0,3,30),
    ('MNQ','Micro E-mini Nasdaq 100','Futures',2,0.25,'USD',0.61,0,'USD',0,0,3,31),
    ('ES','E-mini S&P 500','Futures',50,0.25,'USD',1.89,0,'USD',0,0,3,32),
    ('MES','Micro E-mini S&P 500','Futures',5,0.25,'USD',0.61,0,'USD',0,0,3,33),
    ('6E','Euro FX','Futures',125000,0.00005,'USD',2.11,0,'USD',0,0,3,34),
    ('M6E','Micro EUR/USD','Futures',12500,0.0001,'USD',0.5,0,'USD',0,0,3,35)
  ) as v(symbol, name, asset_class, point_value, tick_size, quote_currency,
         commission_per_lot, commission_pct, commission_currency,
         swap_long, swap_short, swap_triple_day, ord);
end;
$function$;

revoke all on function public.tj_seed_instruments_defaults(uuid) from public, anon, authenticated;

-- Every book that already has a catalog gets the six futures once. An empty
-- book gets them from the seed above, like everything else.
insert into public.tj_instruments (
  user_id, symbol, name, asset_class,
  point_value, tick_size, tick_value, quote_currency,
  commission_per_lot, commission_pct, commission_currency,
  swap_long, swap_short, swap_triple_day,
  is_active, sort_order
)
select u.user_id, v.symbol, v.name, 'Futures',
       v.point_value, v.tick_size, null::numeric, 'USD',
       v.commission_per_lot, 0, 'USD',
       0, 0, 3::smallint,
       true, v.ord
from (select distinct user_id from public.tj_instruments) u
cross join (values
  ('NQ','E-mini Nasdaq 100',20::numeric,0.25::numeric,1.89::numeric,30),
  ('MNQ','Micro E-mini Nasdaq 100',2,0.25,0.61,31),
  ('ES','E-mini S&P 500',50,0.25,1.89,32),
  ('MES','Micro E-mini S&P 500',5,0.25,0.61,33),
  ('6E','Euro FX',125000,0.00005,2.11,34),
  ('M6E','Micro EUR/USD',12500,0.0001,0.5,35)
) as v(symbol, name, point_value, tick_size, commission_per_lot, ord)
on conflict (user_id, symbol) do nothing;
