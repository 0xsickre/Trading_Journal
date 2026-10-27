-- Faza X6 (27.10.2026): brišu se kolone Topstep režima (X-5 A, uz odobrenje trejdera: „Ajde kreni“).
--
-- ZAŠTO. Journal ne zna ni za jednu prop firmu (faza X). Od X4 kolone nijedan deo journala ne čita ni ne piše, a od
-- X8 (X-10, `futures-trading` 06a8b6a) ni brief ni večernja poruka više ne čitaju `tj_accounts`. Provereno
-- 27.10.2026: nijedna funkcija, view ni trigger u bazi ih ne pominje; odlaze samo njihove CHECK provere.
--
-- ŠTA SE GUBI. Vrednosti jedinog Topstep naloga („50K Combine“: plan 50K, combine, lični DLL 650, cilj dana 1.500,
-- rizik 100 % / 300–300) i `room_at_entry` / `risk_budget_at_entry` na njegovih 7 trejdova. Ostaju u noćnom backup-u
-- (`futures-trading/backup/journal/`) i u istoriji git-a; trejdovi, fill-ovi, P&L i R se ne menjaju.

ALTER TABLE public.tj_accounts
  DROP COLUMN IF EXISTS topstep_mode,
  DROP COLUMN IF EXISTS topstep_plan,
  DROP COLUMN IF EXISTS topstep_stage,
  DROP COLUMN IF EXISTS topstep_payout_at,
  DROP COLUMN IF EXISTS topstep_reset_at,
  DROP COLUMN IF EXISTS topstep_personal_dll,
  DROP COLUMN IF EXISTS topstep_daily_target,
  DROP COLUMN IF EXISTS risk_rule_pct,
  DROP COLUMN IF EXISTS risk_rule_min,
  DROP COLUMN IF EXISTS risk_rule_max;

ALTER TABLE public.tj_positions
  DROP COLUMN IF EXISTS room_at_entry,
  DROP COLUMN IF EXISTS risk_budget_at_entry;
