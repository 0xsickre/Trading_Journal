-- K5: every time is shown in the trader's zone (the trader, 29.09.2026: "ne treba ja da biram,
-- treba da uvek bude moja zona po defaultu evropska ... a meni treba da bude sve u mojoj zoni").
--
-- WHY. The account's `timezone` decided how every time was SHOWN and, on a non-Topstep account,
-- which day a trade belonged to. It defaulted to America/New_York and was a free-text field in
-- Settings. The trader lives in Belgrade, and wants to read every fill in his own clock.
--
-- WHAT DOES NOT MOVE. A Topstep account keys its days by Topstep's 17:00 → 17:00 CT trading day
-- (F2, `topstepTradingDay`), whatever this column says — so no trade changes its day, its DLL
-- day or its locked verdict. A file whose times carry an offset (TopstepX: `+02:00`) is read in
-- that offset on import (`parseImportTime`); only an offset-free file is read in this zone.
--
-- The column stays (the code reads it through `DEFAULT_TZ` and `safeTz`); its default and every
-- account move to Europe/Belgrade, and Settings no longer offers to change it.

ALTER TABLE public.tj_accounts ALTER COLUMN timezone SET DEFAULT 'Europe/Belgrade';

UPDATE public.tj_accounts SET timezone = 'Europe/Belgrade' WHERE timezone IS DISTINCT FROM 'Europe/Belgrade';
