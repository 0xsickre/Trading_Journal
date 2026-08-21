-- Week rating: A..F becomes 1..5 stars.
--
-- WHY. The original migration chose the six-point letter scale deliberately,
-- and said so: "the one the trader has already been reading". That reasoning
-- has expired. Execution rating and conviction are both five stars, mental
-- temperature becomes five stars in the migration before this one, and the week
-- was the last place asking the same question in a different alphabet.
--
-- SIX VALUES BECOME FIVE, and that is a real narrowing rather than a rename.
-- It is safe here only because the table holds zero graded weeks -- measured
-- before writing, `count(week_grade) = 0`. With data present this would need a
-- mapping decision (does D become 2 or 1?), and there is no honest default.
--
-- THE COLUMN KEEPS ITS NAME. `week_grade` now holds a number, which reads
-- oddly, and renaming it would touch the zod schema, the server action, the
-- form, the report dimension and the `weekGradeByWeek` map in
-- reports-workbench.tsx -- five files, zero behaviour change, and a rename in
-- the middle of a scale change makes both harder to review. The label the user
-- actually sees has always been "Week rating"; the COMMENT below carries the
-- rest.
--
-- USING NULL rather than a cast: there is nothing to convert, and writing an
-- expression that pretends to map letters to digits would imply a mapping this
-- migration is explicitly not making.

ALTER TABLE public.tj_weekly_reviews
  DROP CONSTRAINT IF EXISTS tj_weekly_reviews_week_grade_check;

ALTER TABLE public.tj_weekly_reviews
  ALTER COLUMN week_grade TYPE smallint USING NULL;

ALTER TABLE public.tj_weekly_reviews
  ADD CONSTRAINT tj_weekly_reviews_week_grade_check
  CHECK (week_grade IS NULL OR (week_grade >= 1 AND week_grade <= 5));

COMMENT ON COLUMN public.tj_weekly_reviews.week_grade IS
  'The week rated 1..5 stars, on the PROCESS rather than the P&L -- a week '
  'followed to the letter and lost money on still scores 5. NULL means not '
  'rated. Named "grade" from when it held A..F; the scale changed, the name '
  'did not, to keep that change reviewable on its own.';
