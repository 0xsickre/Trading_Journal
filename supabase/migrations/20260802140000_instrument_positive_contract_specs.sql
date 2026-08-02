-- tj_instruments carried no CHECK constraints at all, and one of its columns
-- multiplies straight into money.
--
-- `computePositionStats` computes `grossPl = grossPoints * point_value`. A point
-- value of 0 makes every trade on that instrument worth exactly nothing — gross
-- 0, net minus the fees — and a negative one inverts the sign of every P&L on
-- it. Neither raises anything anywhere; the journal simply shows wrong money as
-- fact, which is the failure mode this project treats as worse than a crash.
--
-- Worse than a live-lookup bug: `instrumentSnapshot` FREEZES the value onto the
-- position as `point_value_at_trade` when the trade is created — deliberately,
-- so that later edits to an instrument cannot rewrite finished history. That
-- means a bad point value is copied into every trade booked while it stood, and
-- correcting the instrument afterwards does not correct those trades.
--
-- `addInstrument` and `updateInstrument` now refuse it too, for the better
-- message. This is the guard that actually holds: PostgREST with the user's JWT
-- is a live write path, so a check that lives only in TypeScript is a lock you
-- can walk around.
--
-- `point_value` is NOT NULL already, so its `IS NULL` arm is unreachable and
-- kept only so the three constraints read identically. `tick_size` and
-- `tick_value` ARE nullable — null means "not specified", which `units.ts`
-- already tests for with `(tick_size ?? 0) > 0` before dividing — so for those
-- two the null arm is load-bearing.
--
-- Verified against the live table before applying: 10 rows, none violating.

alter table public.tj_instruments
  add constraint tj_instruments_point_value_positive
  check (point_value is null or point_value > 0);

alter table public.tj_instruments
  add constraint tj_instruments_tick_size_positive
  check (tick_size is null or tick_size > 0);

alter table public.tj_instruments
  add constraint tj_instruments_tick_value_positive
  check (tick_value is null or tick_value > 0);
