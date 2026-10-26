-- Faza B3 (26.10.2026): podrazumevani TF ulaza po playbook-u.
--
-- ZAŠTO. Trejder: TF ulaza je skoro uvek isti za isti setup („3 candle 5min BOS“ → 5m). Polje na trejdu dolazi
-- unapred popunjeno iz playbook-a, a menja se ručno samo kad je drugačije.
--
-- ŠTA. `tj_playbooks.default_entry_tf` (tekst, vrednost iz liste `entry_tf`; NULL = bez podrazumevanog). Upisan za
-- playbook „3 candle 5min BOS“ (trejderov nalog); ostali ostaju prazni. Trejdovi se ne menjaju.

ALTER TABLE public.tj_playbooks ADD COLUMN IF NOT EXISTS default_entry_tf text;

COMMENT ON COLUMN public.tj_playbooks.default_entry_tf IS
  'Entry TF a trade of this playbook gets prefilled with (an entry_tf list value); NULL = none (phase B3).';

UPDATE public.tj_playbooks
   SET default_entry_tf = '5m'
 WHERE name = '3 candle 5min BOS'
   AND default_entry_tf IS NULL;
