-- F5.3b: koliko je trejd proveo "pod vodom" (odluka plana F5, #13: vratiti izostavljena pravila
-- preko R2, podatak piše `futures-trading`).
--
-- ZAŠTO. `most_time_in_drawdown` i `deep_in_drawdown_day` su bili izostavljeni jer traže VREME
-- provedeno u minusu, a MAE/MFE kaže samo koliko duboko, ne koliko dugo. Sveće tačnog ugovora
-- sada postoje u R2 (1 s za prozor trejda), i `journal_mae.py` ih već čita za MAE/MFE.
--
-- ŠTA. `time_underwater_pct` = udeo trajanja trejda (od prvog ulaza do poslednjeg izlaza, u %) u
-- kome je tekući P&L — ostvareno na izlazima + otvoreni ugovori po ceni, bez provizije — bio ispod
-- nule. Piše ga samo `futures-trading` `journal_mae.py`, u istom upisu kao MAE/MFE iz R2; aplikacija
-- ga samo čita. NULL: trejd koji R2 nije izmerio (nije fjučers, odbijen, čeka podatke).

ALTER TABLE public.tj_positions
  ADD COLUMN IF NOT EXISTS time_underwater_pct numeric;

ALTER TABLE public.tj_positions DROP CONSTRAINT IF EXISTS tj_positions_time_underwater_pct_check;
ALTER TABLE public.tj_positions
  ADD CONSTRAINT tj_positions_time_underwater_pct_check
  CHECK (time_underwater_pct IS NULL OR (time_underwater_pct >= 0 AND time_underwater_pct <= 100));

COMMENT ON COLUMN public.tj_positions.time_underwater_pct IS
  'Udeo trajanja trejda (%) sa tekućim P&L < 0, iz R2 sveća (futures-trading journal_mae.py, F5.3b). NULL = nije izmereno.';
