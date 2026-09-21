-- What the trades you did not take were worth.
--
-- WHY. `status = 'missed'` and `miss_reason` have existed since the beginning,
-- and they cost nothing. Every other mistake in this book is priced: a loss is
-- money, a rule broken is a tracker verdict, a bad exit is target attainment.
-- Hesitation is the only one that has never been charged for, which makes it
-- the cheapest mistake to keep making.
--
-- Three columns, written by `scripts/mt5_excursion.py --missed` from the same
-- price history that already fills MAE/MFE:
--
--   missed_outcome  — what the plan would have met first: its target, its stop,
--                     or neither inside the window.
--   missed_r        — the hypothetical result in R: the planned reward when the
--                     target came first, −1 when the stop did, 0 when neither.
--   missed_source   — who wrote it.
--
-- `missed_source` is its OWN enum rather than `excursion_source`. That column
-- is a closed set the excursion script depends on, and widening it to carry a
-- second, unrelated provenance would make one column answer two questions.
--
-- `missed_r` is deliberately NOT added to `tj_positions_prices_positive`: it is
-- negative whenever the stop came first, and that constraint names its columns
-- one by one, so nothing has to be undone — only not done.

ALTER TABLE public.tj_positions
  ADD COLUMN IF NOT EXISTS missed_outcome text,
  ADD COLUMN IF NOT EXISTS missed_r numeric,
  ADD COLUMN IF NOT EXISTS missed_source text;

COMMENT ON COLUMN public.tj_positions.missed_outcome IS
  'Za promašen setup: šta bi plan prvo dodirnuo — target, stop ili nijedno u '
  'prozoru. NULL znači da nije mereno, ne da nije bilo ničega.';

COMMENT ON COLUMN public.tj_positions.missed_r IS
  'Hipotetički rezultat u R: planirani reward kad je target stigao prvi, −1 kad '
  'je stop, 0 kad nijedno. Negativan je normalan, pa ne ide uz prices_positive.';

COMMENT ON COLUMN public.tj_positions.missed_source IS
  'Ko je upisao missed_outcome/missed_r: manual | mt5. Svoj enum, ne '
  'excursion_source — jedna kolona ne odgovara na dva pitanja.';

ALTER TABLE public.tj_positions
  DROP CONSTRAINT IF EXISTS tj_positions_missed_outcome_check;
ALTER TABLE public.tj_positions
  ADD CONSTRAINT tj_positions_missed_outcome_check
  CHECK (missed_outcome IS NULL OR missed_outcome = ANY (ARRAY['target'::text, 'stop'::text, 'neither'::text]));

ALTER TABLE public.tj_positions
  DROP CONSTRAINT IF EXISTS tj_positions_missed_source_check;
ALTER TABLE public.tj_positions
  ADD CONSTRAINT tj_positions_missed_source_check
  CHECK (missed_source IS NULL OR missed_source = ANY (ARRAY['manual'::text, 'mt5'::text]));

-- The sign follows the outcome, or the pair is wrong.
--
-- This is the failure the script's own header warns about: from M1 candles the
-- ORDER of two touches inside one minute cannot be recovered, and a scan that
-- guessed would record a stopped-out plan as a winner. The script refuses that
-- case; this refuses it again, here, where nothing can route around it.
ALTER TABLE public.tj_positions
  DROP CONSTRAINT IF EXISTS tj_positions_missed_r_matches_outcome;
ALTER TABLE public.tj_positions
  ADD CONSTRAINT tj_positions_missed_r_matches_outcome
  CHECK (
    missed_outcome IS NULL OR missed_r IS NULL
    OR (missed_outcome = 'target'  AND missed_r > 0)
    OR (missed_outcome = 'stop'    AND missed_r < 0)
    OR (missed_outcome = 'neither' AND missed_r = 0)
  );

-- A hypothetical outcome belongs to a trade that was MISSED. A plan restored to
-- `planned` is a live idea again, and `restoreTradeToPlanned` clears these
-- three with the miss itself — the same rule `plan_snapshot` follows on the way
-- back from fills.
ALTER TABLE public.tj_positions
  DROP CONSTRAINT IF EXISTS tj_positions_missed_outcome_only_when_missed;
ALTER TABLE public.tj_positions
  ADD CONSTRAINT tj_positions_missed_outcome_only_when_missed
  CHECK (missed_outcome IS NULL OR status = 'missed');
