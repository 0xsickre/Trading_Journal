-- Swing plan: the thesis, what would break it, and when to give up on it.
--
-- The journal could already record WHAT was planned — entry, stop, target, size —
-- but not WHY, and not what would prove the why wrong. For an intraweek swing
-- book that gap is where the money leaks: a position held 2–5 days is re-decided
-- every morning, and without a written invalidation the morning question
-- degenerates into "am I up or down", which is the P&L answering a process
-- question.
--
-- Three columns, and each one exists because a specific question cannot be asked
-- without it:
--
--   thesis          — "why am I in this" in one line. Free text on purpose: it
--                     is read by a human at review, never grouped.
--   invalidation    — "what would convince me I am wrong". This is the ONLY
--                     field a daily check can actually check against; without
--                     it, "is the thesis still good?" has no referent and
--                     becomes a mood reading.
--   time_stop_days  — give up flat after N days unresolved. A trade that has
--                     neither hit target nor stop in weeks is usually a thesis
--                     that quietly died, and the position is paying rent on it.
--
-- All three are NULLABLE and stay so. They describe a plan; an imported trade
-- has no plan, and a trade booked before this migration has none either. NOT
-- NULL here would make the import path unable to write a row.
--
-- No `weekend_hold` column, deliberately. Whether a trade was held over a
-- weekend is DERIVED from its holding window (src/lib/journal/weekend-hold.ts),
-- not self-reported — the same call this schema already made when the manual
-- `result` column was dropped for duplicating the derived outcome. A stored flag
-- can disagree with the dates; a derived one cannot, and it is right for every
-- trade already in the table rather than only for ones filled in by hand.

alter table public.tj_positions
  add column if not exists thesis text,
  add column if not exists invalidation text,
  add column if not exists time_stop_days smallint;

-- Zero days is not a time stop, it is an instruction to close immediately, and
-- a negative one is meaningless. The column is nullable, so "no time stop" is
-- already expressible as NULL — this constraint only refuses the values that
-- would silently read as one.
alter table public.tj_positions
  add constraint tj_positions_time_stop_days_positive
  check (time_stop_days is null or time_stop_days > 0);

-- Two exit reasons the swing rhythm needs and the seeded list does not have.
--
-- "SL hit" and "Manual (loss)" both hide the case that matters most here: the
-- position was closed because the REASON for holding it stopped being true.
-- Without its own bucket that exit is filed as discretion, and "what does
-- holding a dead thesis cost me" cannot be asked of the report engine at all.
--
-- Added to every existing user, not only to the seed for new ones: this is an
-- ADDITION, so nothing the user wrote is touched. `where not exists` keeps it
-- idempotent and leaves a hand-added duplicate alone.
insert into public.tj_option_items (user_id, list_id, value, label, sort_order)
select l.user_id, l.id, v.value, v.value, v.ord
from public.tj_option_lists l
cross join (values
  ('Thesis invalidated', 100),
  ('Time stop', 101)
) as v(value, ord)
where l.key = 'exit_reason'
  and not exists (
    select 1 from public.tj_option_items i
    where i.list_id = l.id and i.value = v.value
  );
