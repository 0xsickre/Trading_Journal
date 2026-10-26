-- Faza X2 (26.10.2026): „practice / demo“ je oznaka naloga, ne faza Topstep naloga.
--
-- ZAŠTO. Trejder (X-4 A): practice nalog ostaje, statistika odvojeno kao do sada. Do sada je practice bio treća
-- vrednost `topstep_stage`, pa ga je imao samo nalog u Topstep režimu. Journal posle faze X ne zna za prop firmu.
--
-- ŠTA.
--   * `tj_accounts.practice` (boolean, podrazumevano false): nalog za vežbu, van „All accounts“.
--   * Prepis: practice = nalog u Topstep režimu sa fazom `practice`. `topstep_stage` ostaje dok ga čita brief
--     u `futures-trading` (X-10), a briše se u X6.

ALTER TABLE public.tj_accounts ADD COLUMN IF NOT EXISTS practice boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.tj_accounts.practice IS
  'Practice / demo account: kept out of "All accounts" and read by choosing it (phase X, X-4).';

UPDATE public.tj_accounts
   SET practice = true
 WHERE topstep_mode
   AND topstep_stage = 'practice'
   AND NOT practice;
