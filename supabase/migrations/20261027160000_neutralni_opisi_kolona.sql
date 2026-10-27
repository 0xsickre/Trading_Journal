-- Faza Z (Z4, Z-5 A, 27.10.2026): opisi tabela i kolona bez imena prop firme.
--
-- ZAŠTO. Trejder (27.10.2026): „Topstep ne treba da se spominje nigde, ni brief ni journal ne treba da zavise od
-- nijedne prop firme.“ Podaci u bazi su već čisti (provereno upitom 27.10.2026); ime firme je ostalo samo u
-- opisima (COMMENT) pet objekata. Odluka Z-5 A: menjaju se samo opisi, ništa drugo.
--
-- ŠTA. Pet COMMENT ON naredbi. Nijedna kolona, red ni ograničenje se ne menja i ništa se ne briše. `tj_daily_bias`
-- i `tj_session_briefs` ostaju kao istorija (faze D/E i X9), `missed_outcome` kao istorija propuštenog setupa (G7);
-- opis kaže šta su bili, bez imena firme. TopstepX ostaje kao ime platforme sa koje je izvoz (Z-3 A), uz ProjectX.

COMMENT ON TABLE public.tj_daily_bias IS
  'Bias dana (faza D, ugašena u fazi E — istorija): prognoza pre sesije po trgovačkom danu i korenu (NQ/ES/GC); meren je najraniji set_at, ocenu (eval_*) je pisao futures-trading iz 1m sveća.';

COMMENT ON TABLE public.tj_session_briefs IS
  'Istorija (od faze X9 se ne piše ni ne čita): jutarnji brief iz futures-trading za jedan trgovački dan — crveni prozori, kraj dana, očekivani raspon.';

COMMENT ON COLUMN public.tj_positions.missed_outcome IS
  'Istorija (propušten setup ugašen u fazi G): target, stop ili neither posle dodira ulaza u trgovačkom danu plana; no_entry = cena nije došla do ulaza. NULL znači da nije mereno, ne da nije bilo ničega.';

COMMENT ON COLUMN public.tj_positions.final_stop_price IS
  'TopstepX (ProjectX) orders export: the stop order''s LAST price. A moved stop keeps only this one; the original is stop_price.';

COMMENT ON COLUMN public.tj_positions.entry_order_type IS
  'TopstepX (ProjectX) orders export: how the entry was placed — market, limit or stop.';
