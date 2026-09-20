-- The catalog becomes this book's broker, and an instrument carries its own costs.
--
-- WHY. The catalog held 91 instruments seeded from "the MT5 convention most
-- brokers keep" — guesses, offered in the trade form beside the ten the account
-- actually trades. Worse, the costs lived on the ACCOUNT as one commission and
-- one swap rate, and this broker charges three different ways: 2.50 USD per lot
-- per side on FX, 0.0007 % of notional on gold and copper, nothing on the
-- index. One number was wrong for at least two of them.
--
-- Swap is stored the way the broker publishes it: in POINTS per lot per night,
-- long and short separately, with one night a week charged three times to cover
-- the weekend — Wednesday on FX and metals, Friday on this broker's index.
-- `instrument-costs.ts` turns points into money (points × tick_size ×
-- point_value × lots), so the numbers here can be checked against the contract
-- sheet without arithmetic.

alter table public.tj_instruments
  add column if not exists commission_per_lot numeric not null default 0
    check (commission_per_lot >= 0),
  add column if not exists commission_pct numeric not null default 0
    check (commission_pct >= 0),
  add column if not exists commission_currency text not null default 'USD'
    check (commission_currency ~ '^[A-Z]{3}$'),
  add column if not exists swap_long numeric not null default 0,
  add column if not exists swap_short numeric not null default 0,
  add column if not exists swap_triple_day smallint not null default 3
    check (swap_triple_day between 1 and 7);

comment on column public.tj_instruments.commission_per_lot is
  'Money per lot, per side (entry and exit are charged separately).';
comment on column public.tj_instruments.commission_pct is
  'Percent of notional, per side. Notional is lots x point_value x price.';
comment on column public.tj_instruments.swap_long is
  'Swap in POINTS per lot per night; negative is a cost to the trader.';
comment on column public.tj_instruments.swap_triple_day is
  'ISO weekday whose night is charged three times (3 = Wednesday, 5 = Friday).';

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
    ('US100.cash','Nasdaq 100 (spot CFD)','Index CFD',1,0.01,'USD',0,0,'USD',-634.31,27.37,5,20)
  ) as v(symbol, name, asset_class, point_value, tick_size, quote_currency,
         commission_per_lot, commission_pct, commission_currency,
         swap_long, swap_short, swap_triple_day, ord);
end;
$function$;

revoke all on function public.tj_seed_instruments_defaults(uuid) from public, anon, authenticated;

-- Existing books with NO trades get the broker's catalog now. A book with even
-- one trade keeps every instrument it has: a trade reads its contract spec to
-- price itself, and replacing the row under it would silently restate history.
do $$
declare
  u uuid;
begin
  for u in
    select distinct i.user_id
    from public.tj_instruments i
    where not exists (select 1 from public.tj_positions p where p.user_id = i.user_id)
  loop
    delete from public.tj_instruments where user_id = u;
    perform public.tj_seed_instruments_defaults(u);
  end loop;
end
$$;
