-- Faza I3 (27.10.2026): uvoz direktno iz NinjaTrader baze, svakih 5 minuta.
--
-- ZAŠTO. Trejder: „da journal uvozi direktno iz NinjaTrader.sqlite bez ručnog izvoza“, „skripta radi svakih 5 min
-- kad radi PC“ (odluke I-4 … I-8 = preporuka). Skripta šalje iste fill-ove više puta (poslednjih 14 dana, svako
-- pokretanje), pa journal mora da prepozna fill koji već ima, i mora da zna koji nalog u platformi je koji nalog u
-- journalu.
--
-- ŠTA (samo dodaje, ništa ne briše).
--   * `tj_executions.external_id` — id fill-a u platformi (NinjaTrader `ExecutionId`); jedinstven po korisniku kad
--     postoji. Ručni i CSV fill-ovi ga nemaju.
--   * `tj_accounts.platform_account` — ime naloga u platformi (npr. Tradeify `TDFY…`); jedinstveno po korisniku kad
--     postoji. Postavlja se u Settings › Accounts.
--   * `tj_replace_executions` prenosi `external_id` (nova definicija; ostalo isto kao `20260929160000`).

ALTER TABLE public.tj_executions ADD COLUMN IF NOT EXISTS external_id text;
CREATE UNIQUE INDEX IF NOT EXISTS tj_executions_user_external_id_key
  ON public.tj_executions USING btree (user_id, external_id)
  WHERE external_id IS NOT NULL;
COMMENT ON COLUMN public.tj_executions.external_id IS
  'The fill''s id in the trading platform (NinjaTrader ExecutionId), phase I3; NULL for manual and CSV fills.';

ALTER TABLE public.tj_accounts ADD COLUMN IF NOT EXISTS platform_account text;
CREATE UNIQUE INDEX IF NOT EXISTS tj_accounts_user_platform_account_key
  ON public.tj_accounts USING btree (user_id, platform_account)
  WHERE platform_account IS NOT NULL;
COMMENT ON COLUMN public.tj_accounts.platform_account IS
  'The account''s name in the trading platform (e.g. a Tradeify account in NinjaTrader), phase I3.';

CREATE OR REPLACE FUNCTION public.tj_replace_executions(p_position_id uuid, p_executions jsonb DEFAULT '[]'::jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_user_id  uuid;
  v_inserted integer;
BEGIN
  SELECT user_id INTO v_user_id
    FROM public.tj_positions
   WHERE id = p_position_id;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Position % not found', p_position_id
      USING ERRCODE = 'no_data_found';
  END IF;

  DELETE FROM public.tj_executions WHERE position_id = p_position_id;

  INSERT INTO public.tj_executions (
    user_id, position_id, side, price, qty, executed_at, fee, source, external_id
  )
  SELECT
    v_user_id,
    p_position_id,
    e.side,
    e.price,
    e.qty,
    e.executed_at,
    COALESCE(e.fee, 0),
    COALESCE(e.source, 'manual'),
    NULLIF(e.external_id, '')
  FROM jsonb_to_recordset(COALESCE(p_executions, '[]'::jsonb)) AS e(
    side         text,
    price        numeric,
    qty          numeric,
    executed_at  timestamptz,
    fee          numeric,
    source       text,
    external_id  text
  )
  WHERE e.side IN ('entry', 'exit')
    AND e.price IS NOT NULL
    AND e.qty > 0
    AND e.executed_at IS NOT NULL;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$function$;

-- Ista prava kao pre (20260730130000): bez PUBLIC i anon.
REVOKE ALL ON FUNCTION public.tj_replace_executions(uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.tj_replace_executions(uuid, jsonb) TO authenticated, service_role;
