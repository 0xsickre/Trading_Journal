-- B6 FTMO instrument universe — sync with Trading data vault (instrument_registry TRADE + RADAR).

-- 1) Rename legacy symbols on existing journal rows
UPDATE public.tj_positions
SET instrument = 'SP500'
WHERE instrument IN ('SPX500USD', 'US500', 'SP500USD');

UPDATE public.tj_positions
SET instrument = 'NAS100'
WHERE instrument IN ('NAS100USD', 'US100', 'USTEC');

-- 2) Canonical seed (10 symbols: 8 trade + 2 radar)
CREATE OR REPLACE FUNCTION public.tj_seed_instruments_defaults(target uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
 begin
   delete from public.tj_instruments
   where user_id = target
     and symbol not in (
       'EURUSD','GBPUSD','USDJPY','USDCAD','AUDUSD',
       'SP500','NAS100','XAUUSD','HG','RTY'
     );

   insert into public.tj_instruments (user_id, symbol, name, asset_class, point_value, tick_size, tick_value, currency, sort_order)
   select target, v.symbol, v.name, v.asset_class, v.point_value, v.tick_size, v.tick_value, 'USD', v.ord
   from (values
     ('EURUSD','Euro / US Dollar','Forex',100000::numeric,0.00001::numeric,null::numeric,0),
     ('GBPUSD','Pound / US Dollar','Forex',100000,0.00001,null,1),
     ('USDJPY','US Dollar / Yen','Forex',100000,0.001,null,2),
     ('USDCAD','US Dollar / Canadian Dollar','Forex',100000,0.00001,null,3),
     ('AUDUSD','Aussie / US Dollar','Forex',100000,0.00001,null,4),
     ('SP500','S&P 500 Index','Index CFD',1,0.1,null,5),
     ('NAS100','Nasdaq 100 Index','Index CFD',1,0.25,null,6),
     ('XAUUSD','Gold / US Dollar','Metals',1,0.01,null,7),
     ('HG','Copper (HG)','Commodities',1,0.0001,null,8),
     ('RTY','Russell 2000 Index','Index CFD',1,0.1,null,9)
   ) as v(symbol, name, asset_class, point_value, tick_size, tick_value, ord)
   on conflict (user_id, symbol) do update set
     name = excluded.name,
     asset_class = excluded.asset_class,
     point_value = excluded.point_value,
     tick_size = excluded.tick_size,
     tick_value = excluded.tick_value,
     sort_order = excluded.sort_order,
     is_active = true;
 end;
 $function$;

-- 3) Re-seed all users
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM auth.users LOOP
    PERFORM public.tj_seed_instruments_defaults(r.id);
  END LOOP;
END $$;
