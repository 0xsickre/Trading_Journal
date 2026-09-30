-- Faza Topstep naloga: Trading Combine ili Express Funded Account (faza T, 30.09.2026, trejder).
--
-- Pravi nalog je 50K Combine; posle prolaza dolazi XFA, a XFA ima druga pravila: najveći broj ugovora
-- raste sa balansom (Scaling Plan), nema cilja ni pravila najboljeg dana od 55 %, a isplata ima dva puta
-- (Standard: 5 dana ≥ $150; Konzistentnost: 3 dana, najbolji dan ≤ 40 % profita). Bez ove kolone journal
-- i brief bi na XFA-u predlagali 15 mini ugovora od prvog dana, a Scaling Plan ispod $1.500 dozvoljava 3.
--
-- Podrazumevano 'combine': postojeći nalozi rade tačno kao do sada dok trejder ne izabere XFA.

ALTER TABLE public.tj_accounts
  ADD COLUMN IF NOT EXISTS topstep_stage text NOT NULL DEFAULT 'combine';

ALTER TABLE public.tj_accounts DROP CONSTRAINT IF EXISTS tj_accounts_topstep_stage_check;
ALTER TABLE public.tj_accounts ADD CONSTRAINT tj_accounts_topstep_stage_check
  CHECK (topstep_stage IN ('combine', 'xfa'));

COMMENT ON COLUMN public.tj_accounts.topstep_stage IS
  'Topstep phase: combine (Trading Combine) or xfa (Express Funded Account: Scaling Plan, payout paths).';
