-- Close a hole in tj_tracker_rules_active_days_check: an EMPTY active_days
-- passes it.
--
-- Both halves of the original CHECK are silent on the empty array:
--
--   active_days <@ ARRAY[1..7]        -- the empty set is a subset of anything
--   array_length(active_days, 1)      -- returns NULL, not 0, for an empty array
--
-- and `NULL BETWEEN 1 AND 7` is NULL, which a CHECK treats as satisfied — only
-- FALSE rejects. So `UPDATE ... SET active_days = '{}'` was accepted. Verified
-- against the live database before writing this.
--
-- Why it matters rather than being pedantry: `compliance.ts` decides
-- applicability by testing `isoWeekday(day) ∈ active_days`, so a rule with no
-- days is applicable on NO day — it sits on the checklist looking tracked while
-- being scored nowhere, and never breaks a streak. That is the one failure mode
-- the whole applicability design exists to avoid. The server action already
-- rejects an empty selection ("a rule that applies on no day is a rule you meant
-- to retire"), but PostgREST with the user's JWT is a live write path, so the
-- action alone is a lock you can walk around with curl — the same argument the
-- tracker migration makes for its lock guards.
--
-- coalesce(..., 0) turns the NULL into a number the comparison can reject. It
-- also rejects a multi-dimensional array, whose `array_length(x, 1)` is the
-- length of the FIRST dimension and could otherwise pass while holding nested
-- rows.

ALTER TABLE public.tj_tracker_rules
  DROP CONSTRAINT IF EXISTS tj_tracker_rules_active_days_check;

ALTER TABLE public.tj_tracker_rules
  ADD CONSTRAINT tj_tracker_rules_active_days_check
  CHECK (
    active_days <@ ARRAY[1,2,3,4,5,6,7]::smallint[]
    AND coalesce(array_length(active_days, 1), 0) BETWEEN 1 AND 7
    AND array_ndims(active_days) = 1
  );
