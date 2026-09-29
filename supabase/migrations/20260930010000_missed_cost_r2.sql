-- F6.1: the missed setup gets its price from R2 (plan #16; the trader, 29.09.2026, decision M1-A).
--
-- WHY. `missed_outcome` / `missed_r` were written by `scripts/mt5_excursion.py --missed`, which went
-- with MT5 in H1; since then nothing priced a missed futures setup and the panel said so. The
-- traded contract's candles are in R2 and `futures-trading/tools/journal_mae.py` already walks
-- them for MAE/MFE, so the same job now walks a missed plan through its Topstep trading day.
--
-- THE RULE (M1-A). A miss "cost" something only if price came back to the plan's entry after the
-- plan was written. From that touch: the stop first is −1R, the target first is the planned reward,
-- neither by the end of the day is 0. A plan whose entry was never reached cost nothing, and it is
-- its own outcome, `no_entry` (R 0) — counted apart, so "I hesitated" and "it never came" are not
-- the same line.
--
-- WHAT CHANGES. `missed_outcome` accepts `no_entry`, with R 0 in the sign CHECK; `missed_source`
-- accepts `r2` (`mt5` stays for history).

ALTER TABLE public.tj_positions DROP CONSTRAINT IF EXISTS tj_positions_missed_outcome_check;
ALTER TABLE public.tj_positions
  ADD CONSTRAINT tj_positions_missed_outcome_check
  CHECK (missed_outcome IS NULL OR missed_outcome = ANY (ARRAY['target'::text, 'stop'::text, 'neither'::text, 'no_entry'::text]));

ALTER TABLE public.tj_positions DROP CONSTRAINT IF EXISTS tj_positions_missed_source_check;
ALTER TABLE public.tj_positions
  ADD CONSTRAINT tj_positions_missed_source_check
  CHECK (missed_source IS NULL OR missed_source = ANY (ARRAY['manual'::text, 'mt5'::text, 'r2'::text]));

ALTER TABLE public.tj_positions DROP CONSTRAINT IF EXISTS tj_positions_missed_r_matches_outcome;
ALTER TABLE public.tj_positions
  ADD CONSTRAINT tj_positions_missed_r_matches_outcome
  CHECK (
    missed_outcome IS NULL OR missed_r IS NULL
    OR (missed_outcome = 'target'   AND missed_r > 0)
    OR (missed_outcome = 'stop'     AND missed_r < 0)
    OR (missed_outcome = 'neither'  AND missed_r = 0)
    OR (missed_outcome = 'no_entry' AND missed_r = 0)
  );

COMMENT ON COLUMN public.tj_positions.missed_outcome IS
  'Za promašen setup: target, stop ili neither posle dodira ulaza u Topstep danu plana; no_entry = '
  'cena nije došla do ulaza. NULL znači da nije mereno, ne da nije bilo ničega.';

COMMENT ON COLUMN public.tj_positions.missed_source IS
  'Ko je upisao missed_outcome/missed_r: manual | mt5 (istorija) | r2 (futures-trading journal_mae.py).';
