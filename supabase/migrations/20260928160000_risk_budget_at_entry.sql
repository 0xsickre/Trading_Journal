-- What the Topstep risk rule allowed at the moment a trade was entered (F3,
-- decision E4, 28.09.2026).
--
-- WHY A COLUMN. On a Topstep account a trade's size is graded against the risk
-- rule — 12.5 % of the room above the Maximum Loss Limit, held between the
-- plan's bounds and never past today's Daily Loss Limit (`computeTopstepRisk`).
-- The room trails the highest end-of-day balance, so the budget of a past entry
-- can be re-derived from the trades that had closed before it — but a
-- correction or a late import that changes one of those trades would then move
-- the measure a decision already made is graded against. The same argument
-- `equity_at_entry` makes for the percentage denominator: capture it when it
-- was true.
--
-- WHEN IT IS WRITTEN. By the manual write path (`createTrade` / `updateTrade`,
-- i.e. the plan form and /trades/log) on the save that first gives the trade an
-- entry fill; never overwritten; cleared if the trade goes back to a plan
-- (`riskBudgetAtEntryPatch`). The import does not seal: a statement arrives
-- after the session, so its "seal" would only be the same derivation made
-- later. A trade with no seal — imported, or older than this column — reads
-- the budget derived from the account's closed trades at its entry
-- (`riskBudgetAt`), which is why there is no backfill.
--
-- 0 IS AN ANSWER. An account with no room above its MLL, or no DLL left, allowed
-- nothing; that is written. NULL means not a Topstep account, or never entered.

ALTER TABLE public.tj_positions
  ADD COLUMN IF NOT EXISTS risk_budget_at_entry numeric;

COMMENT ON COLUMN public.tj_positions.risk_budget_at_entry IS
  'Topstep: the risk budget (account currency) the risk rule allowed at the '
  'moment of entry, frozen when the trade first got an entry fill. 0 = no room. '
  'NULL = not a Topstep account, never entered, or unsealed (readers derive it). '
  'Written by lib/journal/equity-at-entry.ts riskBudgetAtEntryPatch.';

ALTER TABLE public.tj_positions
  DROP CONSTRAINT IF EXISTS tj_positions_risk_budget_at_entry_nonnegative;
ALTER TABLE public.tj_positions
  ADD CONSTRAINT tj_positions_risk_budget_at_entry_nonnegative
  CHECK (risk_budget_at_entry IS NULL OR risk_budget_at_entry >= 0);
