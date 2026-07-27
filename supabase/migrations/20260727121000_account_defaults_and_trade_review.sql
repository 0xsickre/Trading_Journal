-- Per-account trade defaults + review flags on positions.
--
-- breakeven_from / breakeven_to fix a real defect: outcome was classified as
-- breakeven only when net P&L equalled exactly 0, tested on a float that already
-- includes fees and swap. That is practically never true, so the breakeven bucket
-- was always empty and win rate had nothing to exclude from its denominator.
-- The range is deliberately ASYMMETRIC (e.g. -37.50 .. 0), not a +/- tolerance.
--
-- Defaults are 0..0, which reproduces the old exact-zero behaviour, so this
-- migration changes no existing number until the range is configured.

ALTER TABLE public.tj_accounts
  ADD COLUMN breakeven_from numeric NOT NULL DEFAULT 0,
  ADD COLUMN breakeven_to numeric NOT NULL DEFAULT 0,
  -- 'currency': range is in account currency.
  -- 'pct': range is a percentage of starting_balance.
  ADD COLUMN breakeven_unit text NOT NULL DEFAULT 'currency'
    CHECK (breakeven_unit IN ('currency', 'pct')),

  -- Cost defaults, applied when a new execution row is added in the trade form.
  ADD COLUMN default_commission_per_unit numeric NOT NULL DEFAULT 0,
  ADD COLUMN default_fee_fixed numeric NOT NULL DEFAULT 0,
  -- Per unit, per calendar day held. Used to prefill swap on exit fills.
  ADD COLUMN default_swap_per_day numeric NOT NULL DEFAULT 0,

  -- Risk plan defaults, applied when a stop / target is left empty.
  ADD COLUMN default_stop_pct numeric,
  ADD COLUMN default_target_pct numeric,

  -- Execution matching method. Stored now, honoured when scale-in across
  -- overlapping positions on one symbol is supported.
  ADD COLUMN profit_calc_method text NOT NULL DEFAULT 'fifo'
    CHECK (profit_calc_method IN ('fifo', 'lifo', 'weighted_avg')),

  ADD CONSTRAINT tj_accounts_breakeven_range_ordered
    CHECK (breakeven_from <= breakeven_to);

-- `needs_review` already exists but means "the import left this trade incomplete".
-- `reviewed` is the different, user-owned statement: I have looked at this trade.
ALTER TABLE public.tj_positions
  ADD COLUMN reviewed boolean NOT NULL DEFAULT false,
  ADD COLUMN rating smallint CHECK (rating BETWEEN 1 AND 5);

CREATE INDEX tj_positions_reviewed_idx
  ON public.tj_positions (user_id, reviewed);
