-- C3: replace a position's fills atomically.
--
-- updateTrade, the import merge path and the import undo all did this:
--
--   snapshot the old fills -> DELETE them -> INSERT the new ones
--                          -> on failure, try to INSERT the snapshot back
--
-- Three problems with that shape, all of them about a window where the trade
-- exists with no fills:
--
--   * The rollback is application-level and its own INSERT result was never
--     checked. If it failed the fills were gone for good, and the caller
--     reported only the original error.
--   * Between the DELETE and the INSERT — two round trips to a remote database
--     — any concurrent reader sees the position with zero fills: status reads
--     as 'planned', net_pl as null. That includes a second browser tab, a
--     revalidated page render, and the FTMO freeze check.
--   * The restore lost each execution's id, so rows came back as new records.
--
-- A function body is a single implicit transaction, so either the new fills
-- land or the old ones were never deleted. There is no window in between.
--
-- SECURITY INVOKER (the default, stated explicitly) keeps RLS on tj_executions
-- applying to the caller: a user still cannot touch another user's fills, and
-- the position_id is verified against tj_positions under the same policy.

CREATE OR REPLACE FUNCTION public.tj_replace_executions(
  p_position_id uuid,
  p_executions  jsonb DEFAULT '[]'::jsonb
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

  DELETE FROM public.tj_executions WHERE position_id = p_position_id;

  -- Ownership is taken from the parent position rather than left to the
  -- column's auth.uid() default: a fill must belong to whoever owns the trade,
  -- and the default silently yields NULL outside a request context.
  INSERT INTO public.tj_executions (
    user_id, position_id, side, price, qty, executed_at, fee, swap_funding, source
  )
  SELECT
    v_user_id,
    p_position_id,
    e.side,
    e.price,
    e.qty,
    e.executed_at,
    COALESCE(e.fee, 0),
    COALESCE(e.swap_funding, 0),
    COALESCE(e.source, 'manual')
  FROM jsonb_to_recordset(COALESCE(p_executions, '[]'::jsonb)) AS e(
    side         text,
    price        numeric,
    qty          numeric,
    executed_at  timestamptz,
    fee          numeric,
    swap_funding numeric,
    source       text
  )
  -- Same guard the TypeScript callers apply, enforced at the boundary so a
  -- malformed row can never reach the table.
  WHERE e.side IN ('entry', 'exit')
    AND e.price IS NOT NULL
    AND e.qty > 0
    AND e.executed_at IS NOT NULL;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.tj_replace_executions(uuid, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.tj_replace_executions(uuid, jsonb) TO authenticated, service_role;
