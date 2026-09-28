-- Topstep accounts, and a futures-only catalog.
--
-- 1) Topstep's rules are money, not percentages, and its Maximum Loss Limit
--    trails the highest END-OF-DAY balance and locks at the starting balance —
--    nothing the FTMO columns (fixed % of a fixed start) can describe. The rules
--    themselves live in src/lib/journal/topstep.ts (`TOPSTEP_PLANS`); the account
--    only says WHICH plan it is, when its first payout was (from then on the
--    floor is the starting balance) and when it was restarted.
--
-- 2) The trader's risk rule (futures-trading `izlaz/Uputstvo_rizik.pdf`): risk
--    per trade is a share of the room above the MLL, held between two amounts.
--    `risk_rule_min/max` null means the plan's own bounds, scaled so three stops
--    fit in its Daily Loss Limit (50K 60/300, 100K 120/600, 150K 180/900).
--
-- 3) One prop firm's rules per account: FTMO or Topstep, never both.
--
-- 4) The catalog is the six futures. The CFD and FX rows go — ONLY those no
--    trade names, so no trade loses the spec it prices itself by; a symbol that
--    was traded stays until the trader removes it. The seed offers futures only.

ALTER TABLE public.tj_accounts
  ADD COLUMN IF NOT EXISTS topstep_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS topstep_plan text NOT NULL DEFAULT '50K',
  ADD COLUMN IF NOT EXISTS topstep_payout_at timestamptz,
  ADD COLUMN IF NOT EXISTS topstep_reset_at timestamptz,
  ADD COLUMN IF NOT EXISTS risk_rule_pct numeric NOT NULL DEFAULT 12.5,
  ADD COLUMN IF NOT EXISTS risk_rule_min numeric,
  ADD COLUMN IF NOT EXISTS risk_rule_max numeric;

ALTER TABLE public.tj_accounts DROP CONSTRAINT IF EXISTS tj_accounts_topstep_plan_check;
ALTER TABLE public.tj_accounts ADD CONSTRAINT tj_accounts_topstep_plan_check
  CHECK (topstep_plan = ANY (ARRAY['50K'::text, '100K'::text, '150K'::text]));

ALTER TABLE public.tj_accounts DROP CONSTRAINT IF EXISTS tj_accounts_one_prop_firm;
ALTER TABLE public.tj_accounts ADD CONSTRAINT tj_accounts_one_prop_firm
  CHECK (NOT (ftmo_mode AND topstep_mode));

ALTER TABLE public.tj_accounts DROP CONSTRAINT IF EXISTS tj_accounts_risk_rule_check;
ALTER TABLE public.tj_accounts ADD CONSTRAINT tj_accounts_risk_rule_check
  CHECK (risk_rule_pct > 0 AND risk_rule_pct <= 100
     AND (risk_rule_min IS NULL OR risk_rule_min > 0)
     AND (risk_rule_max IS NULL OR risk_rule_max > 0)
     AND (risk_rule_min IS NULL OR risk_rule_max IS NULL OR risk_rule_min <= risk_rule_max));

COMMENT ON COLUMN public.tj_accounts.topstep_mode IS
  'Topstep rules on this account (src/lib/journal/topstep.ts). Exclusive with ftmo_mode.';
COMMENT ON COLUMN public.tj_accounts.topstep_plan IS
  '50K / 100K / 150K — MLL, DLL, target and position cap come from TOPSTEP_PLANS.';
COMMENT ON COLUMN public.tj_accounts.topstep_payout_at IS
  'First payout. From then on the MLL floor is the starting balance (Topstep''s $0).';
COMMENT ON COLUMN public.tj_accounts.risk_rule_pct IS
  'Risk per trade as % of the room above the MLL (the trader''s rule: 12.5).';
COMMENT ON COLUMN public.tj_accounts.risk_rule_min IS
  'Risk-per-trade floor in money; null = the plan''s own.';
COMMENT ON COLUMN public.tj_accounts.risk_rule_max IS
  'Risk-per-trade ceiling in money; null = the plan''s own.';

-- The catalog: CFD/FX rows nobody traded are removed.
DELETE FROM public.tj_instruments i
 WHERE i.asset_class IS DISTINCT FROM 'Futures'
   AND NOT EXISTS (
     SELECT 1 FROM public.tj_positions p
      WHERE p.user_id = i.user_id AND p.instrument = i.symbol
   );

create or replace function public.tj_seed_instruments_defaults(target uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  -- Only ever for an empty book. Re-running this must not resurrect a symbol
  -- the trader deleted, which is what `20260920001500` was written to stop.
  if exists (select 1 from public.tj_instruments where user_id = target) then
    return;
  end if;

  insert into public.tj_instruments (
    user_id, symbol, name, asset_class,
    point_value, tick_size, tick_value, quote_currency,
    commission_per_lot, commission_pct, commission_currency,
    swap_long, swap_short, swap_triple_day,
    is_active, sort_order
  )
  select target, v.symbol, v.name, 'Futures',
         v.point_value, v.tick_size, null::numeric, 'USD',
         v.commission_per_lot, 0, 'USD',
         0, 0, 3::smallint,
         true, v.ord
  from (values
    ('NQ','E-mini Nasdaq 100',20::numeric,0.25::numeric,1.89::numeric,30),
    ('MNQ','Micro E-mini Nasdaq 100',2,0.25,0.61,31),
    ('ES','E-mini S&P 500',50,0.25,1.89,32),
    ('MES','Micro E-mini S&P 500',5,0.25,0.61,33),
    ('6E','Euro FX',125000,0.00005,2.11,34),
    ('M6E','Micro EUR/USD',12500,0.0001,0.5,35)
  ) as v(symbol, name, point_value, tick_size, commission_per_lot, ord);
end;
$function$;

revoke all on function public.tj_seed_instruments_defaults(uuid) from public, anon, authenticated;
