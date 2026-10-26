-- Faza B2 (26.10.2026): kraće liste na stranici trejda.
--
-- ZAŠTO. Trejder: ručni unos po trejdu da traje ~30 s. Tehnički tagovi na formi su samo Sweep likvidnosti, SMT
-- divergencija i FVG. Ručne greške su samo one koje journal ne može da izračuna. Ostale greške računa journal sam
-- (B4) ili se više ne mere (B-1).
--
-- ŠTA. `is_active = false`: opcija se ne nudi na novom trejdu, a stari trejd koji je ima zadržava je i prikazuje
-- (forma čita samo aktivne opcije, vrednost na trejdu je tekst). Ništa se ne briše; Settings › Categories može da
-- vrati opciju.

UPDATE public.tj_option_items i
   SET is_active = false
  FROM public.tj_option_lists l
 WHERE l.id = i.list_id
   AND l.key = 'technical_tag'
   AND i.is_active
   AND i.value NOT IN ('Sweep likvidnosti', 'SMT divergencija', 'FVG');

UPDATE public.tj_option_items i
   SET is_active = false
  FROM public.tj_option_lists l
 WHERE l.id = i.list_id
   AND l.key = 'mistake'
   AND i.is_active
   AND i.value NOT IN ('Bez greške', 'Rani ulaz', 'Jurio cenu', 'Teza posle klika', 'Osvetnički ponovni ulaz',
                       'Rano zatvorio dobitak', 'Stop postavio bracket, ne ja');
