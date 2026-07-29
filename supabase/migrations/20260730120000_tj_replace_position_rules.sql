-- H2: replace a trade's playbook answers atomically.
--
-- saveRuleAnswers (src/app/(app)/trades/actions.ts) did this:
--
--   DELETE every answer for the position -> INSERT the submitted set
--
-- as two separate round trips, with no rollback of any kind. If the INSERT
-- failed — a retired rule id, a transient network error, an RLS refusal — the
-- DELETE had already committed and every recorded answer for that trade was
-- gone. In updateTrade the position UPDATE has committed by then too, so the
-- error the caller returns undoes nothing.
--
-- This is the same failure that tj_replace_executions (20260728121000) was
-- written to eliminate for fills. Rule answers carry the follow rate, which
-- feeds every process report and the discipline half of the score, so they
-- deserve the same guarantee: a function body is one implicit transaction, and
-- either the new answers land or the old ones were never deleted.
--
-- Delete-then-insert rather than upsert, deliberately: a rule the trader
-- UN-answered has no key in the payload at all, and an upsert would leave the
-- withdrawn judgement standing and keep counting it.
--
-- SECURITY INVOKER (the default, stated explicitly) keeps RLS on
-- tj_position_rules applying to the caller.

CREATE OR REPLACE FUNCTION public.tj_replace_position_rules(
  p_position_id uuid,
  p_rules       jsonb DEFAULT '[]'::jsonb
) RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user_id  uuid;
  v_inserted integer;
BEGIN
  -- RLS hides other users' positions, so a row the caller cannot see is
  -- indistinguishable from one that does not exist. Both are refusals.
  SELECT user_id INTO v_user_id
    FROM public.tj_positions
   WHERE id = p_position_id;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Position % not found', p_position_id
      USING ERRCODE = 'no_data_found';
  END IF;

  DELETE FROM public.tj_position_rules WHERE position_id = p_position_id;

  -- Ownership comes from the parent position rather than from auth.uid(): an
  -- answer must belong to whoever owns the trade, and the default silently
  -- yields NULL outside a request context.
  INSERT INTO public.tj_position_rules (user_id, position_id, rule_id, followed)
  SELECT
    v_user_id,
    p_position_id,
    r.rule_id,
    r.followed
  FROM jsonb_to_recordset(COALESCE(p_rules, '[]'::jsonb)) AS r(
    rule_id  uuid,
    followed boolean
  )
  WHERE r.rule_id IS NOT NULL
  -- The payload carries only answered rules; an unanswered one is absent, not
  -- null. Enforced at the boundary so a malformed submission cannot write the
  -- "not answered" state as though it were an answer.
    AND r.followed IS NOT NULL;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

-- `anon` named explicitly alongside PUBLIC. Revoking PUBLIC alone is enough for a
-- function created here and now, but four sibling functions were found with anon
-- EXECUTE because a later rebuild handed the PUBLIC grant back (see
-- 20260730130000_harden_invoker_function_grants.sql) — so the intent is stated
-- rather than left to be inferred from the default.
REVOKE ALL ON FUNCTION public.tj_replace_position_rules(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tj_replace_position_rules(uuid, jsonb)
  TO authenticated, service_role;
