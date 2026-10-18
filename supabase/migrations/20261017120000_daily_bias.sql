-- Faza D: bias dana kao prognoza pre sesije (trejder, 17.10.2026, odluke D-1 … D-6).
--
-- ZAŠTO. Bias je do sada bio polje na trejdu (`custom.htf_bias`), biran posle sesije: dan bez trejda
-- nema bias, a da li je bias bio tačan niko ne meri (mentor Z-016: bias nastaje dok trejder gleda cenu).
-- Trejder hoće da ga upiše pre trgovanja, jednom dnevno po instrumentu, i da journal sam iz cena kaže da
-- li je pogodio — i da to uporedi sa naivnim „uvek long“.
--
-- ŠTA. Jedan red = jedna prognoza: Topstep dan, koren (NQ, ES, GC; MNQ/MES/MGC dele koren), smer
-- gore / dole / neutral i jedna rečenica zašto. Promena tokom dana je NOV red; meri se najraniji
-- `set_at`, da se bias ne bi menjao dok ga cena ne potvrdi. `set_at` piše okidač (vrednost iz klijenta se
-- ignoriše). Posle upisa se prognoza ne menja; jedino ocena (`eval_*`) sme da se upiše, a nju piše
-- futures-trading (`journal_mae.py`) kroz PostgREST kao korisnik, pa RLS važi.
--
-- OCENA (D-1 … D-4): početak = kasnije od 09:00 BG i `set_at`, kraj 18:00 BG; pomeraj = cena kraja −
-- cena početka; opseg = 25. percentil |pomeraja| istog prozora u 60 prethodnih trgovačkih dana. Dan je
-- `neutral` kad je |pomeraj| < opseg, inače `gore` / `dole`. `eval_status`: ok, bez_cena (rupa u svećama),
-- bez_istorije (< 40 dana), prekasno (upis posle 18:00).
--
-- BRISANJE. Nema DELETE politike: prognoza se ne povlači. Jedini izlaz je „Delete all data“
-- (`tj_reset_my_data`), koji postavlja `tj.bypass_lock_guard` kao i za zaključane dane.

CREATE TABLE IF NOT EXISTS public.tj_daily_bias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  trading_day date NOT NULL,
  root text NOT NULL,
  bias text NOT NULL,
  reason text,
  set_at timestamptz NOT NULL DEFAULT now(),
  eval_status text,
  eval_start_at timestamptz,
  eval_start_price numeric,
  eval_end_price numeric,
  eval_move numeric,
  eval_band numeric,
  eval_day text,
  eval_contract text,
  eval_source text,
  evaluated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tj_daily_bias_root CHECK (root IN ('NQ', 'ES', 'GC')),
  CONSTRAINT tj_daily_bias_bias CHECK (bias IN ('gore', 'dole', 'neutral')),
  CONSTRAINT tj_daily_bias_reason_len CHECK (reason IS NULL OR char_length(reason) <= 500),
  CONSTRAINT tj_daily_bias_eval_status
    CHECK (eval_status IS NULL OR eval_status IN ('ok', 'bez_cena', 'bez_istorije', 'prekasno')),
  CONSTRAINT tj_daily_bias_eval_day CHECK (eval_day IS NULL OR eval_day IN ('gore', 'dole', 'neutral')),
  CONSTRAINT tj_daily_bias_eval_source CHECK (eval_source IS NULL OR eval_source = 'r2'),
  -- `ok` nosi ceo račun; ostali statusi ga nemaju.
  CONSTRAINT tj_daily_bias_eval_ok CHECK (
    eval_status IS DISTINCT FROM 'ok' OR (
      eval_start_at IS NOT NULL AND eval_start_price IS NOT NULL AND eval_end_price IS NOT NULL
      AND eval_move IS NOT NULL AND eval_band IS NOT NULL AND eval_band >= 0 AND eval_day IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS tj_daily_bias_day
  ON public.tj_daily_bias (user_id, trading_day, root, set_at);

ALTER TABLE public.tj_daily_bias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tj_daily_bias_select ON public.tj_daily_bias;
CREATE POLICY tj_daily_bias_select ON public.tj_daily_bias
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS tj_daily_bias_insert ON public.tj_daily_bias;
CREATE POLICY tj_daily_bias_insert ON public.tj_daily_bias
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS tj_daily_bias_update ON public.tj_daily_bias;
CREATE POLICY tj_daily_bias_update ON public.tj_daily_bias
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS tj_daily_bias_reset ON public.tj_daily_bias;
CREATE POLICY tj_daily_bias_reset ON public.tj_daily_bias
  FOR DELETE TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND coalesce(current_setting('tj.bypass_lock_guard', true), '') = 'on'
  );

-- Prognoza je zapečaćena: posle upisa se menja samo ocena.
CREATE OR REPLACE FUNCTION public.tj_daily_bias_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.set_at := now();
    NEW.eval_status := NULL;
    NEW.eval_start_at := NULL;
    NEW.eval_start_price := NULL;
    NEW.eval_end_price := NULL;
    NEW.eval_move := NULL;
    NEW.eval_band := NULL;
    NEW.eval_day := NULL;
    NEW.eval_contract := NULL;
    NEW.eval_source := NULL;
    NEW.evaluated_at := NULL;
    RETURN NEW;
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.trading_day IS DISTINCT FROM OLD.trading_day
     OR NEW.root IS DISTINCT FROM OLD.root
     OR NEW.bias IS DISTINCT FROM OLD.bias
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.set_at IS DISTINCT FROM OLD.set_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Bias dana se ne menja posle upisa; promena je nov upis'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tj_daily_bias_guard ON public.tj_daily_bias;
CREATE TRIGGER tj_daily_bias_guard
  BEFORE INSERT OR UPDATE ON public.tj_daily_bias
  FOR EACH ROW EXECUTE FUNCTION public.tj_daily_bias_guard();

DROP TRIGGER IF EXISTS tj_daily_bias_updated_at ON public.tj_daily_bias;
CREATE TRIGGER tj_daily_bias_updated_at
  BEFORE UPDATE ON public.tj_daily_bias
  FOR EACH ROW EXECUTE FUNCTION public.tj_set_updated_at();

COMMENT ON TABLE public.tj_daily_bias IS
  'Bias dana (faza D): prognoza pre sesije po Topstep danu i korenu (NQ/ES/GC); meri se najraniji set_at. '
  'Ocenu (eval_*) piše futures-trading journal_mae.py iz 1m sveća.';

-- `tj_reset_my_data` vodi listu tabela RUČNO. Prepisano iz 20261008120000_drop_weekly_experiments_focus.sql
-- sa JEDNIM redom više (tj_daily_bias).

CREATE OR REPLACE FUNCTION public.tj_reset_my_data()
RETURNS void
LANGUAGE plpgsql
SET search_path TO ''
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The lock guard (a locked day) and the system "Trade Notes" folder refuse
  -- deletes unless this is set, and they are right to — except here, where the
  -- user has asked for everything to go.
  PERFORM set_config('tj.bypass_lock_guard', 'on', true);

  DELETE FROM public.tj_position_rules      WHERE user_id = v_uid;
  DELETE FROM public.tj_trade_images        WHERE user_id = v_uid;
  DELETE FROM public.tj_executions          WHERE user_id = v_uid;
  DELETE FROM public.tj_import_rows         WHERE user_id = v_uid;
  DELETE FROM public.tj_positions           WHERE user_id = v_uid;
  DELETE FROM public.tj_import_batches      WHERE user_id = v_uid;
  DELETE FROM public.tj_playbook_rule_links WHERE user_id = v_uid;
  DELETE FROM public.tj_playbook_sections   WHERE user_id = v_uid;
  DELETE FROM public.tj_playbook_rules      WHERE user_id = v_uid;
  DELETE FROM public.tj_playbooks           WHERE user_id = v_uid;
  DELETE FROM public.tj_tracker_checkins    WHERE user_id = v_uid;
  DELETE FROM public.tj_tracker_rules       WHERE user_id = v_uid;
  DELETE FROM public.tj_daily_reports       WHERE user_id = v_uid;
  DELETE FROM public.tj_session_briefs      WHERE user_id = v_uid;
  DELETE FROM public.tj_daily_bias          WHERE user_id = v_uid;
  DELETE FROM public.tj_notes               WHERE user_id = v_uid;
  DELETE FROM public.tj_note_folders        WHERE user_id = v_uid;
  DELETE FROM public.tj_note_tags           WHERE user_id = v_uid;
  DELETE FROM public.tj_cash_events         WHERE user_id = v_uid;
  DELETE FROM public.tj_accounts            WHERE user_id = v_uid;
  DELETE FROM public.tj_option_items        WHERE user_id = v_uid;
  DELETE FROM public.tj_option_lists        WHERE user_id = v_uid;
  DELETE FROM public.tj_field_defs          WHERE user_id = v_uid;
  DELETE FROM public.tj_instruments         WHERE user_id = v_uid;
  DELETE FROM public.tj_dashboard_templates WHERE user_id = v_uid;
  DELETE FROM public.tj_user_prefs          WHERE user_id = v_uid;

  PERFORM public.tj_seed_my_defaults();
END;
$$;

COMMENT ON FUNCTION public.tj_reset_my_data() IS
  'Deletes all 26 tj_ tables for the caller, then re-seeds defaults. Table list is maintained by hand — add new tables here.';

REVOKE ALL ON FUNCTION public.tj_reset_my_data() FROM PUBLIC, anon;

-- ZLATO (D-5). Trejder trguje i MGC, a katalog ga nije imao. Fabrička lista dobija GC i MGC
-- (TopstepX, „Commissions and Fees“, 18.10.2026: 4.32 / 1.92 round turn, pola po strani), a knjiga koja
-- već ima instrumente dobija ih jednom, ovde: GC/MGC nikad nisu bili u katalogu, pa ovo ne vraća simbol
-- koji je trejder obrisao. Prepisano iz 20260929160000_drop_swap.sql sa dva reda više.

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
    is_active, sort_order
  )
  select target, v.symbol, v.name, 'Futures',
         v.point_value, v.tick_size, null::numeric, 'USD',
         v.commission_per_lot, 0, 'USD',
         true, v.ord
  from (values
    ('NQ','E-mini Nasdaq 100',20::numeric,0.25::numeric,1.89::numeric,30),
    ('MNQ','Micro E-mini Nasdaq 100',2,0.25,0.61,31),
    ('ES','E-mini S&P 500',50,0.25,1.89,32),
    ('MES','Micro E-mini S&P 500',5,0.25,0.61,33),
    ('6E','Euro FX',125000,0.00005,2.11,34),
    ('M6E','Micro EUR/USD',12500,0.0001,0.5,35),
    ('GC','Gold',100,0.1,2.16,36),
    ('MGC','Micro Gold',10,0.1,0.96,37)
  ) as v(symbol, name, point_value, tick_size, commission_per_lot, ord);
end;
$function$;

insert into public.tj_instruments (
  user_id, symbol, name, asset_class,
  point_value, tick_size, tick_value, quote_currency,
  commission_per_lot, commission_pct, commission_currency,
  is_active, sort_order
)
select u.user_id, v.symbol, v.name, 'Futures',
       v.point_value, v.tick_size, null::numeric, 'USD',
       v.commission_per_lot, 0, 'USD',
       true, v.ord
from (select distinct user_id from public.tj_instruments) u
cross join (values
  ('GC','Gold',100::numeric,0.1::numeric,2.16::numeric,36),
  ('MGC','Micro Gold',10,0.1,0.96,37)
) as v(symbol, name, point_value, tick_size, commission_per_lot, ord)
on conflict (user_id, symbol) do nothing;
