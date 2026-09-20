-- The weekly review closes its own loop: did last week's one change survive?
--
-- The review asks for "one thing I change next week" and then never mentions it
-- again — it is written once and read by nothing, so a commitment costs nothing
-- to break. This column holds the answer given the FOLLOWING week, on that
-- week's row: the judgement is made then, and last week's row may already be
-- sealed (the lock trigger refuses every update of a locked row, so the answer
-- could not be written there even if it belonged there).
--
-- Three values rather than a boolean. "Partly" is the honest answer most weeks
-- deserve, and a yes/no forces it into whichever neighbour flatters least.
alter table public.tj_weekly_reviews
  add column if not exists previous_change_kept text
    check (previous_change_kept in ('yes', 'partly', 'no'));

comment on column public.tj_weekly_reviews.previous_change_kept is
  'Answer to the PREVIOUS week''s one_change, recorded on this week''s row.';
