-- Faza SP (13.11.2026): slepi pregled trejda otvorenog kroz Terminal panel.
--
-- ZAŠTO. Trejder (playbook v2) ocenjuje trejd pre nego što vidi rezultat: jak POI (da / ne), po planu (A / B / C, već
-- postoji kao `execution_rating`) i greška (već postoji kao `mistake`). Rezultat se otkriva tek kad su sva tri sačuvana.
--
-- ŠTA (samo dodaje, ništa ne briše).
--   * `tj_positions.poi_strong` — da li je POI bio jak; NULL = nije odgovoreno (ili trejd nije za slepi pregled).

ALTER TABLE public.tj_positions ADD COLUMN IF NOT EXISTS poi_strong boolean;
COMMENT ON COLUMN public.tj_positions.poi_strong IS
  'Blind review (phase SP): was the POI strong? true / false, answered before the result is shown; NULL = not answered.';
