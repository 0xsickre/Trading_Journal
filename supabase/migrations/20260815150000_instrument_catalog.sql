-- Katalog instrumenata, i dva baga u seed-u koja su ga do sada činila
-- neupotrebljivim za bilo šta osim deset zakucanih simbola.
--
-- BAG 1 — RUČNO DODAT INSTRUMENT SE BRIŠE
--
-- `tj_seed_instruments_defaults` je počinjala sa:
--
--     delete from public.tj_instruments
--     where user_id = target and symbol not in ('EURUSD', ... , 'RTY');
--
-- Funkciju zove `tj_seed_defaults`, nju `tj_seed_my_defaults`, a njega
-- `ensureDefaults()` na SVAKO učitavanje početne strane. Dodaš instrument u
-- Settings-u, odeš na Dashboard, instrumenta nema. Izmereno:
--
--     pre  seed-a:  MOJSIMBOL postoji  (1 red)
--     posle:        MOJSIMBOL obrisan  (0 redova)
--
-- Isti obrazac je već jednom popravljen na strani ČITANJA — `instruments.ts:18`
-- nosi komentar „Deliberately unfiltered by symbol. This used to restrict
-- results to DEFAULT_INSTRUMENT_SYMBOLS…". Popravka nije stigla do pisanja.
--
-- BAG 2 — DEAKTIVIRAN INSTRUMENT SE SAM VRAĆA
--
-- `on conflict do update set ... is_active = true` je gazio korisnikov izbor.
-- Ugasiš instrument u Settings-u, učitaš početnu, opet je upaljen. Izmereno na
-- istom prolazu: `is_active` false → true.
--
-- ŠTA SE MENJA
--
-- Seed od sada samo NUDI: `on conflict do nothing`. Ne briše, ne prepisuje, ne
-- pali. Sve što korisnik uradi sa instrumentom ostaje kako je ostavio.
--
-- Cena te odluke je da ispravke specifikacija više ne stižu same, pa ide jedna
-- jednokratna sinhronizacija ODMAH ISPOD — i to je poslednji put da seed dira
-- postojeći red. `is_active` se ni tada ne dira.
--
-- KATALOG
--
-- 91 instrument, CFD i futures razdvojeni, generisan iz
-- `src/lib/journal/default-instruments.ts` da se specifikacije ne prekucavaju
-- dvaput. Aktivno je jedanaest — forma čita `getInstruments(true)`, pa ostalo
-- stoji spremno i pali se jednim klikom.
--
-- Tri specifikacije koje su do sada bile POGREŠNE:
--
--   XAUUSD  point_value 1 → 100      1 lot je 100 unci, ne jedna
--   HG      point_value 1 → 25 000   COMEX bakar je 25 000 funti po ugovoru
--   RTY     point_value 1 → 50       RTY je futures ugovor, ne CFD; CFD je US2000
--
-- Zlato je bilo potcenjeno sto puta, bakar dvadeset pet hiljada puta.

CREATE OR REPLACE FUNCTION public.tj_seed_instruments_defaults(target uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
 begin
   insert into public.tj_instruments (
     user_id, symbol, name, asset_class,
     point_value, tick_size, tick_value, quote_currency, is_active, sort_order
   )
   select target, v.symbol, v.name, v.asset_class,
          v.point_value, v.tick_size, v.tick_value, v.quote_currency,
          v.is_active, v.ord
   from (values
     ('EURUSD','Euro / US Dollar','Forex',100000::numeric,0.00001::numeric,null::numeric,'USD',true,0),
     ('GBPUSD','Pound / US Dollar','Forex',100000,0.00001,null,'USD',true,1),
     ('USDJPY','US Dollar / Yen','Forex',100000,0.001,null,'JPY',true,2),
     ('USDCHF','US Dollar / Swiss Franc','Forex',100000,0.00001,null,'CHF',false,3),
     ('USDCAD','US Dollar / Canadian Dollar','Forex',100000,0.00001,null,'CAD',true,4),
     ('AUDUSD','Aussie / US Dollar','Forex',100000,0.00001,null,'USD',true,5),
     ('NZDUSD','Kiwi / US Dollar','Forex',100000,0.00001,null,'USD',false,6),
     ('EURGBP','Euro / Pound','Forex',100000,0.00001,null,'GBP',false,100),
     ('EURJPY','Euro / Yen','Forex',100000,0.001,null,'JPY',false,101),
     ('EURCHF','Euro / Swiss Franc','Forex',100000,0.00001,null,'CHF',false,102),
     ('EURAUD','Euro / Aussie','Forex',100000,0.00001,null,'AUD',false,103),
     ('EURCAD','Euro / Canadian Dollar','Forex',100000,0.00001,null,'CAD',false,104),
     ('EURNZD','Euro / Kiwi','Forex',100000,0.00001,null,'NZD',false,105),
     ('GBPJPY','Pound / Yen','Forex',100000,0.001,null,'JPY',false,106),
     ('GBPCHF','Pound / Swiss Franc','Forex',100000,0.00001,null,'CHF',false,107),
     ('GBPAUD','Pound / Aussie','Forex',100000,0.00001,null,'AUD',false,108),
     ('GBPCAD','Pound / Canadian Dollar','Forex',100000,0.00001,null,'CAD',false,109),
     ('GBPNZD','Pound / Kiwi','Forex',100000,0.00001,null,'NZD',false,110),
     ('AUDJPY','Aussie / Yen','Forex',100000,0.001,null,'JPY',false,111),
     ('AUDCHF','Aussie / Swiss Franc','Forex',100000,0.00001,null,'CHF',false,112),
     ('AUDCAD','Aussie / Canadian Dollar','Forex',100000,0.00001,null,'CAD',false,113),
     ('AUDNZD','Aussie / Kiwi','Forex',100000,0.00001,null,'NZD',false,114),
     ('NZDJPY','Kiwi / Yen','Forex',100000,0.001,null,'JPY',false,115),
     ('NZDCHF','Kiwi / Swiss Franc','Forex',100000,0.00001,null,'CHF',false,116),
     ('NZDCAD','Kiwi / Canadian Dollar','Forex',100000,0.00001,null,'CAD',false,117),
     ('CADJPY','Canadian Dollar / Yen','Forex',100000,0.001,null,'JPY',false,118),
     ('CADCHF','Canadian Dollar / Swiss Franc','Forex',100000,0.00001,null,'CHF',false,119),
     ('CHFJPY','Swiss Franc / Yen','Forex',100000,0.001,null,'JPY',false,120),
     ('XAUUSD','Gold / US Dollar (spot)','Metals CFD',100,0.01,null,'USD',true,200),
     ('XAGUSD','Silver / US Dollar (spot)','Metals CFD',5000,0.001,null,'USD',false,201),
     ('XPTUSD','Platinum / US Dollar (spot)','Metals CFD',100,0.01,null,'USD',false,202),
     ('USOIL','WTI Crude Oil (spot CFD)','Energy CFD',1000,0.01,null,'USD',false,210),
     ('UKOIL','Brent Crude Oil (spot CFD)','Energy CFD',1000,0.01,null,'USD',false,211),
     ('NATGAS','Natural Gas (spot CFD)','Energy CFD',10000,0.001,null,'USD',false,212),
     ('SP500','S&P 500 (CFD)','Index CFD',1,0.1,null,'USD',true,300),
     ('NAS100','Nasdaq 100 (CFD)','Index CFD',1,0.25,null,'USD',true,301),
     ('US30','Dow Jones 30 (CFD)','Index CFD',1,1,null,'USD',false,302),
     ('US2000','Russell 2000 (CFD)','Index CFD',1,0.1,null,'USD',true,303),
     ('GER40','DAX 40 (CFD)','Index CFD',1,0.1,null,'EUR',false,304),
     ('UK100','FTSE 100 (CFD)','Index CFD',1,0.1,null,'GBP',false,305),
     ('FRA40','CAC 40 (CFD)','Index CFD',1,0.1,null,'EUR',false,306),
     ('EU50','Euro Stoxx 50 (CFD)','Index CFD',1,0.1,null,'EUR',false,307),
     ('ESP35','IBEX 35 (CFD)','Index CFD',1,0.1,null,'EUR',false,308),
     ('SUI20','SMI 20 (CFD)','Index CFD',1,0.1,null,'CHF',false,309),
     ('JP225','Nikkei 225 (CFD)','Index CFD',1,1,null,'JPY',false,310),
     ('AUS200','ASX 200 (CFD)','Index CFD',1,1,null,'AUD',false,311),
     ('HK50','Hang Seng (CFD)','Index CFD',1,1,null,'HKD',false,312),
     ('ES','E-mini S&P 500','Index Futures',50,0.25,12.5,'USD',false,400),
     ('MES','Micro E-mini S&P 500','Index Futures',5,0.25,1.25,'USD',false,401),
     ('NQ','E-mini Nasdaq 100','Index Futures',20,0.25,5,'USD',false,402),
     ('MNQ','Micro E-mini Nasdaq 100','Index Futures',2,0.25,0.5,'USD',false,403),
     ('YM','E-mini Dow','Index Futures',5,1,5,'USD',false,404),
     ('MYM','Micro E-mini Dow','Index Futures',0.5,1,0.5,'USD',false,405),
     ('RTY','E-mini Russell 2000','Index Futures',50,0.1,5,'USD',true,406),
     ('M2K','Micro E-mini Russell 2000','Index Futures',5,0.1,0.5,'USD',false,407),
     ('FDAX','DAX Futures','Index Futures',25,1,25,'EUR',false,408),
     ('FDXM','Mini-DAX Futures','Index Futures',5,1,5,'EUR',false,409),
     ('FESX','Euro Stoxx 50 Futures','Index Futures',10,1,10,'EUR',false,410),
     ('NKD','Nikkei 225 Futures (USD)','Index Futures',5,5,25,'USD',false,411),
     ('GC','Gold Futures','Metals Futures',100,0.1,10,'USD',false,500),
     ('MGC','Micro Gold Futures','Metals Futures',10,0.1,1,'USD',false,501),
     ('SI','Silver Futures','Metals Futures',5000,0.005,25,'USD',false,502),
     ('HG','Copper Futures','Metals Futures',25000,0.0005,12.5,'USD',true,503),
     ('PL','Platinum Futures','Metals Futures',50,0.1,5,'USD',false,504),
     ('PA','Palladium Futures','Metals Futures',100,0.1,10,'USD',false,505),
     ('CL','WTI Crude Oil Futures','Energy Futures',1000,0.01,10,'USD',false,600),
     ('MCL','Micro WTI Crude Oil Futures','Energy Futures',100,0.01,1,'USD',false,601),
     ('NG','Natural Gas Futures','Energy Futures',10000,0.001,10,'USD',false,602),
     ('RB','RBOB Gasoline Futures','Energy Futures',42000,0.0001,4.2,'USD',false,603),
     ('HO','Heating Oil Futures','Energy Futures',42000,0.0001,4.2,'USD',false,604),
     ('ZC','Corn Futures','Agriculture Futures',50,0.25,12.5,'USD',false,700),
     ('ZS','Soybean Futures','Agriculture Futures',50,0.25,12.5,'USD',false,701),
     ('ZW','Wheat Futures','Agriculture Futures',50,0.25,12.5,'USD',false,702),
     ('ZL','Soybean Oil Futures','Agriculture Futures',600,0.01,6,'USD',false,703),
     ('ZM','Soybean Meal Futures','Agriculture Futures',100,0.1,10,'USD',false,704),
     ('KC','Coffee C Futures','Softs Futures',375,0.05,18.75,'USD',false,710),
     ('SB','Sugar No.11 Futures','Softs Futures',1120,0.01,11.2,'USD',false,711),
     ('CT','Cotton No.2 Futures','Softs Futures',500,0.01,5,'USD',false,712),
     ('CC','Cocoa Futures','Softs Futures',10,1,10,'USD',false,713),
     ('ZB','30-Year T-Bond Futures','Rates Futures',1000,0.03125,31.25,'USD',false,800),
     ('UB','Ultra T-Bond Futures','Rates Futures',1000,0.03125,31.25,'USD',false,801),
     ('ZN','10-Year T-Note Futures','Rates Futures',1000,0.015625,15.625,'USD',false,802),
     ('ZF','5-Year T-Note Futures','Rates Futures',1000,0.0078125,7.8125,'USD',false,803),
     ('ZT','2-Year T-Note Futures','Rates Futures',2000,0.00390625,7.8125,'USD',false,804),
     ('6E','Euro FX Futures','FX Futures',125000,0.00005,6.25,'USD',false,900),
     ('6B','British Pound Futures','FX Futures',62500,0.0001,6.25,'USD',false,901),
     ('6J','Japanese Yen Futures','FX Futures',12500000,5e-7,6.25,'USD',false,902),
     ('6A','Australian Dollar Futures','FX Futures',100000,0.0001,10,'USD',false,903),
     ('6C','Canadian Dollar Futures','FX Futures',100000,0.00005,5,'USD',false,904),
     ('6S','Swiss Franc Futures','FX Futures',125000,0.0001,12.5,'USD',false,905),
     ('6N','New Zealand Dollar Futures','FX Futures',100000,0.0001,10,'USD',false,906)
  ) as v(symbol, name, asset_class, point_value, tick_size, tick_value,
         quote_currency, is_active, ord)
   -- NE `do update`. Vidi zaglavlje: korisnikov instrument i korisnikov izbor
   -- aktivnosti su njegovi, a seed samo popunjava ono čega nema.
   on conflict (user_id, symbol) do nothing;
 end;
 $function$;

REVOKE ALL ON FUNCTION public.tj_seed_instruments_defaults(uuid) FROM PUBLIC, anon, authenticated;

-- Jednokratna ispravka TRI specifikacije koje su bile pogrešne. Namerno samo te
-- tri, a ne sinhronizacija svih 91: ispravlja se ono što se zna da ne valja, i
-- to je poslednji put da išta automatski prepisuje postojeći red. `is_active` se
-- ne dira ni ovde.
--
-- Istorijski P&L je zaštićen nezavisno od ovoga — `point_value_at_trade` je
-- snimljen na trejdu, pa ispravka specifikacije ne pomera nijedan već upisan
-- rezultat. To je i bila poenta snapshot-a (20260728120000).
UPDATE public.tj_instruments SET
  name = 'Gold / US Dollar (spot)', asset_class = 'Metals CFD',
  point_value = 100, tick_size = 0.01, tick_value = null, sort_order = 200
WHERE symbol = 'XAUUSD';

UPDATE public.tj_instruments SET
  name = 'Copper Futures', asset_class = 'Metals Futures',
  point_value = 25000, tick_size = 0.0005, tick_value = 12.5, sort_order = 503
WHERE symbol = 'HG';

UPDATE public.tj_instruments SET
  name = 'E-mini Russell 2000', asset_class = 'Index Futures',
  point_value = 50, tick_size = 0.1, tick_value = 5, sort_order = 406
WHERE symbol = 'RTY';

-- Preostalih sedam starih redova samo dobija novo ime i mesto u katalogu;
-- brojke su im bile tačne.
UPDATE public.tj_instruments SET name = 'S&P 500 (CFD)',    sort_order = 300 WHERE symbol = 'SP500';
UPDATE public.tj_instruments SET name = 'Nasdaq 100 (CFD)', sort_order = 301 WHERE symbol = 'NAS100';

-- Seed za sve postojeće korisnike, da katalog stigne bez čekanja na prvu prijavu.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM auth.users LOOP
    PERFORM public.tj_seed_instruments_defaults(r.id);
  END LOOP;
END $$;
