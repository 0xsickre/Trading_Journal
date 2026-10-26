-- Faza X4 (26.10.2026): „ravno do“ je vreme naloga, ne Topstep-ovo.
--
-- ZAŠTO. Trejder (X-9 A): vreme do kog pozicija mora biti zatvorena podešava se u Settings, podrazumevano 16:00 po
-- Čikagu (dnevna pauza CME-a). Do sada je pravilo `flat_by_close` čitalo 15:10 CT — Topstep-ovo zatvaranje — i
-- važilo samo na nalogu u Topstep režimu. Dan je od X4 CME dan (17:00 → 17:00 CT) na svakom nalogu (X-3 A).
--
-- ŠTA.
--   * `tj_accounts.flat_by` (tekst `HH:MM`, sat po Čikagu, podrazumevano '16:00'). Ranije zatvaranje iz brief-a
--     (praznik) i dalje pobeđuje; obično 15:10 iz brief-a više ne.
--   * Tekst pravila „Ravno do kraja Topstep dana“ → „Ravno do kraja dana“ (samo tekst, ocene se ne menjaju).

ALTER TABLE public.tj_accounts ADD COLUMN IF NOT EXISTS flat_by text NOT NULL DEFAULT '16:00';

ALTER TABLE public.tj_accounts DROP CONSTRAINT IF EXISTS tj_accounts_flat_by_hhmm;
ALTER TABLE public.tj_accounts ADD CONSTRAINT tj_accounts_flat_by_hhmm
  CHECK (flat_by ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

COMMENT ON COLUMN public.tj_accounts.flat_by IS
  'Flat-by time on Chicago''s clock (HH:MM): flat_by_close grades against it; an earlier close in the brief wins (phase X, X-9).';

UPDATE public.tj_tracker_rules
   SET text = 'Ravno do kraja dana'
 WHERE auto_key = 'flat_by_close'
   AND text = 'Ravno do kraja Topstep dana';
