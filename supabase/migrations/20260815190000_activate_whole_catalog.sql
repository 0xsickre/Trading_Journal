-- Ceo katalog se nudi u formi, ne samo jedanaest simbola.
--
-- `20260815150000` je unelo 91 instrument ali samo 11 označilo kao aktivne.
-- Forma čita `getInstruments(true)`, pa je posledica bila da 80 instrumenata
-- postoji u Settings-u a ne može da se izabere pri unosu trejda. Vlasnik je to
-- primetio i s pravom: katalog je i tražen zato da bude spreman za upotrebu, a
-- ne da se svaki instrument prvo negde „pali".
--
-- Razlog za onaj kompromis je bio strah da padajuća lista od 91 stavke postane
-- neupotrebljiva. To je stvaran problem, ali pogrešno rešen: rešenje za dugačku
-- listu je GRUPISANJE, ne skrivanje. Lista je sada grupisana po klasi
-- instrumenta (Forex, Index CFD, Index Futures, …), a Radix Select ima
-- ugrađeno kucanje-za-skok, pa se do simbola stiže u dva poteza.
--
-- Kolona `is_active` ostaje. Nije mrtva: `getInstruments(true)` je čita, a
-- `updateInstrument` je i dalje prima. Ono što je nikad nije menjalo jeste UI —
-- `InstrumentManager` nikad nije imao taj prekidač. Korisnik koji ne trguje
-- nekim instrumentom briše ga, ne gasi.

UPDATE public.tj_instruments SET is_active = true WHERE is_active = false;

-- Seed unosi nove redove kao aktivne. `on conflict do nothing` ostaje: postojeći
-- red se ne dira, pa ovo ne može da vrati u život instrument koji je korisnik
-- namerno obrisao — obrisan red se ponovo unosi, ali to je ponašanje seed-a od
-- 20260815150000 i menja se odvojeno ako ikad zatreba.
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
          true, v.ord
   from (values
     ('EURUSD','Euro / US Dollar','Forex',100000::numeric,0.00001::numeric,null::numeric,'USD',0),
     ('GBPUSD','Pound / US Dollar','Forex',100000,0.00001,null,'USD',1),
     ('USDJPY','US Dollar / Yen','Forex',100000,0.001,null,'JPY',2),
     ('USDCHF','US Dollar / Swiss Franc','Forex',100000,0.00001,null,'CHF',3),
     ('USDCAD','US Dollar / Canadian Dollar','Forex',100000,0.00001,null,'CAD',4),
     ('AUDUSD','Aussie / US Dollar','Forex',100000,0.00001,null,'USD',5),
     ('NZDUSD','Kiwi / US Dollar','Forex',100000,0.00001,null,'USD',6),
     ('EURGBP','Euro / Pound','Forex',100000,0.00001,null,'GBP',100),
     ('EURJPY','Euro / Yen','Forex',100000,0.001,null,'JPY',101),
     ('EURCHF','Euro / Swiss Franc','Forex',100000,0.00001,null,'CHF',102),
     ('EURAUD','Euro / Aussie','Forex',100000,0.00001,null,'AUD',103),
     ('EURCAD','Euro / Canadian Dollar','Forex',100000,0.00001,null,'CAD',104),
     ('EURNZD','Euro / Kiwi','Forex',100000,0.00001,null,'NZD',105),
     ('GBPJPY','Pound / Yen','Forex',100000,0.001,null,'JPY',106),
     ('GBPCHF','Pound / Swiss Franc','Forex',100000,0.00001,null,'CHF',107),
     ('GBPAUD','Pound / Aussie','Forex',100000,0.00001,null,'AUD',108),
     ('GBPCAD','Pound / Canadian Dollar','Forex',100000,0.00001,null,'CAD',109),
     ('GBPNZD','Pound / Kiwi','Forex',100000,0.00001,null,'NZD',110),
     ('AUDJPY','Aussie / Yen','Forex',100000,0.001,null,'JPY',111),
     ('AUDCHF','Aussie / Swiss Franc','Forex',100000,0.00001,null,'CHF',112),
     ('AUDCAD','Aussie / Canadian Dollar','Forex',100000,0.00001,null,'CAD',113),
     ('AUDNZD','Aussie / Kiwi','Forex',100000,0.00001,null,'NZD',114),
     ('NZDJPY','Kiwi / Yen','Forex',100000,0.001,null,'JPY',115),
     ('NZDCHF','Kiwi / Swiss Franc','Forex',100000,0.00001,null,'CHF',116),
     ('NZDCAD','Kiwi / Canadian Dollar','Forex',100000,0.00001,null,'CAD',117),
     ('CADJPY','Canadian Dollar / Yen','Forex',100000,0.001,null,'JPY',118),
     ('CADCHF','Canadian Dollar / Swiss Franc','Forex',100000,0.00001,null,'CHF',119),
     ('CHFJPY','Swiss Franc / Yen','Forex',100000,0.001,null,'JPY',120),
     ('XAUUSD','Gold / US Dollar (spot)','Metals CFD',100,0.01,null,'USD',200),
     ('XAGUSD','Silver / US Dollar (spot)','Metals CFD',5000,0.001,null,'USD',201),
     ('XPTUSD','Platinum / US Dollar (spot)','Metals CFD',100,0.01,null,'USD',202),
     ('USOIL','WTI Crude Oil (spot CFD)','Energy CFD',1000,0.01,null,'USD',210),
     ('UKOIL','Brent Crude Oil (spot CFD)','Energy CFD',1000,0.01,null,'USD',211),
     ('NATGAS','Natural Gas (spot CFD)','Energy CFD',10000,0.001,null,'USD',212),
     ('SP500','S&P 500 (CFD)','Index CFD',1,0.1,null,'USD',300),
     ('NAS100','Nasdaq 100 (CFD)','Index CFD',1,0.25,null,'USD',301),
     ('US30','Dow Jones 30 (CFD)','Index CFD',1,1,null,'USD',302),
     ('US2000','Russell 2000 (CFD)','Index CFD',1,0.1,null,'USD',303),
     ('GER40','DAX 40 (CFD)','Index CFD',1,0.1,null,'EUR',304),
     ('UK100','FTSE 100 (CFD)','Index CFD',1,0.1,null,'GBP',305),
     ('FRA40','CAC 40 (CFD)','Index CFD',1,0.1,null,'EUR',306),
     ('EU50','Euro Stoxx 50 (CFD)','Index CFD',1,0.1,null,'EUR',307),
     ('ESP35','IBEX 35 (CFD)','Index CFD',1,0.1,null,'EUR',308),
     ('SUI20','SMI 20 (CFD)','Index CFD',1,0.1,null,'CHF',309),
     ('JP225','Nikkei 225 (CFD)','Index CFD',1,1,null,'JPY',310),
     ('AUS200','ASX 200 (CFD)','Index CFD',1,1,null,'AUD',311),
     ('HK50','Hang Seng (CFD)','Index CFD',1,1,null,'HKD',312),
     ('ES','E-mini S&P 500','Index Futures',50,0.25,12.5,'USD',400),
     ('MES','Micro E-mini S&P 500','Index Futures',5,0.25,1.25,'USD',401),
     ('NQ','E-mini Nasdaq 100','Index Futures',20,0.25,5,'USD',402),
     ('MNQ','Micro E-mini Nasdaq 100','Index Futures',2,0.25,0.5,'USD',403),
     ('YM','E-mini Dow','Index Futures',5,1,5,'USD',404),
     ('MYM','Micro E-mini Dow','Index Futures',0.5,1,0.5,'USD',405),
     ('RTY','E-mini Russell 2000','Index Futures',50,0.1,5,'USD',406),
     ('M2K','Micro E-mini Russell 2000','Index Futures',5,0.1,0.5,'USD',407),
     ('FDAX','DAX Futures','Index Futures',25,1,25,'EUR',408),
     ('FDXM','Mini-DAX Futures','Index Futures',5,1,5,'EUR',409),
     ('FESX','Euro Stoxx 50 Futures','Index Futures',10,1,10,'EUR',410),
     ('NKD','Nikkei 225 Futures (USD)','Index Futures',5,5,25,'USD',411),
     ('GC','Gold Futures','Metals Futures',100,0.1,10,'USD',500),
     ('MGC','Micro Gold Futures','Metals Futures',10,0.1,1,'USD',501),
     ('SI','Silver Futures','Metals Futures',5000,0.005,25,'USD',502),
     ('HG','Copper Futures','Metals Futures',25000,0.0005,12.5,'USD',503),
     ('PL','Platinum Futures','Metals Futures',50,0.1,5,'USD',504),
     ('PA','Palladium Futures','Metals Futures',100,0.1,10,'USD',505),
     ('CL','WTI Crude Oil Futures','Energy Futures',1000,0.01,10,'USD',600),
     ('MCL','Micro WTI Crude Oil Futures','Energy Futures',100,0.01,1,'USD',601),
     ('NG','Natural Gas Futures','Energy Futures',10000,0.001,10,'USD',602),
     ('RB','RBOB Gasoline Futures','Energy Futures',42000,0.0001,4.2,'USD',603),
     ('HO','Heating Oil Futures','Energy Futures',42000,0.0001,4.2,'USD',604),
     ('ZC','Corn Futures','Agriculture Futures',50,0.25,12.5,'USD',700),
     ('ZS','Soybean Futures','Agriculture Futures',50,0.25,12.5,'USD',701),
     ('ZW','Wheat Futures','Agriculture Futures',50,0.25,12.5,'USD',702),
     ('ZL','Soybean Oil Futures','Agriculture Futures',600,0.01,6,'USD',703),
     ('ZM','Soybean Meal Futures','Agriculture Futures',100,0.1,10,'USD',704),
     ('KC','Coffee C Futures','Softs Futures',375,0.05,18.75,'USD',710),
     ('SB','Sugar No.11 Futures','Softs Futures',1120,0.01,11.2,'USD',711),
     ('CT','Cotton No.2 Futures','Softs Futures',500,0.01,5,'USD',712),
     ('CC','Cocoa Futures','Softs Futures',10,1,10,'USD',713),
     ('ZB','30-Year T-Bond Futures','Rates Futures',1000,0.03125,31.25,'USD',800),
     ('UB','Ultra T-Bond Futures','Rates Futures',1000,0.03125,31.25,'USD',801),
     ('ZN','10-Year T-Note Futures','Rates Futures',1000,0.015625,15.625,'USD',802),
     ('ZF','5-Year T-Note Futures','Rates Futures',1000,0.0078125,7.8125,'USD',803),
     ('ZT','2-Year T-Note Futures','Rates Futures',2000,0.00390625,7.8125,'USD',804),
     ('6E','Euro FX Futures','FX Futures',125000,0.00005,6.25,'USD',900),
     ('6B','British Pound Futures','FX Futures',62500,0.0001,6.25,'USD',901),
     ('6J','Japanese Yen Futures','FX Futures',12500000,0.0000005,6.25,'USD',902),
     ('6A','Australian Dollar Futures','FX Futures',100000,0.0001,10,'USD',903),
     ('6C','Canadian Dollar Futures','FX Futures',100000,0.00005,5,'USD',904),
     ('6S','Swiss Franc Futures','FX Futures',125000,0.0001,12.5,'USD',905),
     ('6N','New Zealand Dollar Futures','FX Futures',100000,0.0001,10,'USD',906)
  ) as v(symbol, name, asset_class, point_value, tick_size, tick_value,
         quote_currency, ord)
   on conflict (user_id, symbol) do nothing;
 end;
 $function$;

REVOKE ALL ON FUNCTION public.tj_seed_instruments_defaults(uuid) FROM PUBLIC, anon, authenticated;
