-- How the position was meant to be taken off, written before it was taken on.
--
-- The trade already carries ONE `target_price`. That is a day trader's exit: one
-- level, one fill, done. A position held 2–5 days is usually reduced in pieces —
-- some off at 1R, the rest left to run — and none of that is expressible today.
--
-- THE MEASUREMENT GAP THIS CLOSES, which is the reason it is a column and not a
-- nice-to-have:
--
-- `tj_position_checkins.touched` records `partial_exit` on the day it happens.
-- Without a plan to compare it against, that value cannot distinguish EXECUTING
-- THE PLAN from BAILING EARLY — and those are opposite facts about a trader.
-- One is discipline; the other is the behaviour the journal exists to catch.
-- This is the same class of error phase 2 fixed for `micromanage`: a value that
-- looks like a finding but has no referent.
--
-- Free text, deliberately. A structured scale-out (rows of "N % at X R") would
-- be inventing a schema for how this trader scales, before there is a single
-- trade in the book to learn it from. One sentence — "50 % at 1R, rest to
-- target" — answers the only question being asked of it. Structure it later if
-- the notes turn out to have a shape; a column can be split, a wrong schema has
-- to be migrated out of.
--
-- Nullable and staying so: an imported trade has no plan, and a trade booked
-- before this migration has none either.

alter table public.tj_positions
  add column if not exists scale_out_plan text;

comment on column public.tj_positions.scale_out_plan is
  'Planned scale-out, free text. Read against tj_position_checkins.touched = ''partial_exit'' to tell a planned reduction from an early exit.';
