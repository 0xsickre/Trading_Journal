-- `tj_seed_instruments_defaults` je i dalje upisivala u kolonu `currency`, koju
-- je prethodna migracija preimenovala u `quote_currency`.
--
-- Nađeno izvršavanjem, ne čitanjem:
--
--     PADA: column "currency" of relation "tj_instruments" does not exist
--
-- Lanac zbog kojeg ovo nije sitnica. Funkciju zove `tj_seed_defaults`, nju zove
-- `tj_seed_my_defaults` (RPC koji `ensureDefaults()` pušta na svako učitavanje
-- početne strane) i `tj_on_auth_user_created` (okidač na registraciji). Okidač
-- svoj poziv drži u `EXCEPTION` bloku, a taj blok je podtransakcija — pad ovde
-- poništio bi CEO seed novog korisnika i vratio tačno onaj bag koji je
-- `20260815120000_fix_auth_seed_trigger.sql` upravo zatvorio, samo sa drugim
-- uzrokom.
--
-- Pouka koju vredi zapisati: preimenovanje kolone ne prijavljuje pozivaoce koji
-- žive u telima PL/pgSQL funkcija. `search_path = ''` i kvalifikovana imena tu
-- ne pomažu — telo se ne proverava pri kreiranju, nego pri izvršavanju. Posle
-- svakog RENAME COLUMN treba proći kroz `pg_get_functiondef` i potražiti staro
-- ime, što je ovde i urađeno: samo `tj_seed_defaults` još pominje „currency", i
-- to je `tj_accounts.currency`, koja nije dirana.
--
-- Uz popravku ide i `quote_currency` u `on conflict do update`, da bi se
-- ispravljene vrednosti (USDJPY → JPY, USDCAD → CAD) propagirale i na naloge
-- koji su seedovani pre ove izmene. Sve ostale kolone su ionako već tu, pa je to
-- postojeća konvencija ove funkcije, ne nova.

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

   insert into public.tj_instruments (
     user_id, symbol, name, asset_class,
     point_value, tick_size, tick_value, quote_currency, sort_order
   )
   select target, v.symbol, v.name, v.asset_class,
          v.point_value, v.tick_size, v.tick_value, v.quote_currency, v.ord
   from (values
     -- point_value = novac u valuti kotacije po 1.00 pomeraja, po 1 jedinici qty.
     -- Za FX to znači 1 standardni lot; JPY i CAD parovi zarađuju u svojoj valuti
     -- i od sada prolaze kroz kurs pre nego što uđu u bilo koji zbir.
     ('EURUSD','Euro / US Dollar','Forex',100000::numeric,0.00001::numeric,null::numeric,'USD',0),
     ('GBPUSD','Pound / US Dollar','Forex',100000,0.00001,null,'USD',1),
     ('USDJPY','US Dollar / Yen','Forex',100000,0.001,null,'JPY',2),
     ('USDCAD','US Dollar / Canadian Dollar','Forex',100000,0.00001,null,'CAD',3),
     ('AUDUSD','Aussie / US Dollar','Forex',100000,0.00001,null,'USD',4),
     ('SP500','S&P 500 Index','Index CFD',1,0.1,null,'USD',5),
     ('NAS100','Nasdaq 100 Index','Index CFD',1,0.25,null,'USD',6),
     ('XAUUSD','Gold / US Dollar','Metals',1,0.01,null,'USD',7),
     ('HG','Copper (HG)','Commodities',1,0.0001,null,'USD',8),
     ('RTY','Russell 2000 Index','Index CFD',1,0.1,null,'USD',9)
   ) as v(symbol, name, asset_class, point_value, tick_size, tick_value, quote_currency, ord)
   on conflict (user_id, symbol) do update set
     name = excluded.name,
     asset_class = excluded.asset_class,
     point_value = excluded.point_value,
     tick_size = excluded.tick_size,
     tick_value = excluded.tick_value,
     quote_currency = excluded.quote_currency,
     sort_order = excluded.sort_order,
     is_active = true;
 end;
 $function$;

REVOKE ALL ON FUNCTION public.tj_seed_instruments_defaults(uuid) FROM PUBLIC, anon, authenticated;
