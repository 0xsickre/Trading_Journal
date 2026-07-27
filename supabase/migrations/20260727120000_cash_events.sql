-- Cash events: deposits, withdrawals, prop-firm payouts and manual adjustments.
--
-- Why this exists: every percentage view in the app divides by an account balance.
-- Without cash flow the balance is `starting_balance + realized P&L`, which silently
-- goes wrong the moment money moves in or out — and wrong percentages are worse than
-- missing ones. This table is the second half of that denominator.
--
-- $ drawdown keeps using cumulative P&L (cash flow is not a loss); % drawdown uses
-- equity including these events. Two bases, two views — see lib/journal/balance.ts.

CREATE TABLE public.tj_cash_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.tj_accounts(id) ON DELETE CASCADE,

  event_type text NOT NULL CHECK (
    event_type IN ('deposit', 'withdrawal', 'payout', 'adjustment')
  ),

  -- Signed amount in the account currency. Deposits are positive; withdrawals and
  -- payouts are stored negative so the timeline is a plain running sum and no reader
  -- has to remember which types subtract.
  amount numeric NOT NULL CHECK (amount <> 0),

  occurred_at timestamptz NOT NULL DEFAULT now(),
  note text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tj_cash_events_sign_matches_type CHECK (
    (event_type = 'deposit' AND amount > 0)
    OR (event_type IN ('withdrawal', 'payout') AND amount < 0)
    OR (event_type = 'adjustment')
  )
);

CREATE INDEX tj_cash_events_user_account_time_idx
  ON public.tj_cash_events (user_id, account_id, occurred_at DESC);

ALTER TABLE public.tj_cash_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY tj_cash_events_owner ON public.tj_cash_events
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE TRIGGER tj_cash_events_updated_at
  BEFORE UPDATE ON public.tj_cash_events
  FOR EACH ROW EXECUTE FUNCTION public.tj_set_updated_at();
