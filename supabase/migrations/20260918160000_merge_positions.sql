-- Two rows that are the same trade become one.
--
-- The import can recognise a hand-typed trade and merge into it, but only at
-- import time. Two rows already in the journal — one typed, one imported before
-- the matcher could see it — had no way to become one, and every total counted
-- the trade twice.
--
-- WHAT THIS DOES
--
--   fills        taken WHOLE from `p_fills_from`; the survivor's are deleted
--   money        follows the fills: the override and the instrument snapshot
--   plan, grade  the survivor's, and only the EMPTY ones are filled in
--   tags         union of the two
--   children     images, rule answers and check-ins move over where the
--                survivor has no row for that key; notes and import rows are
--                repointed
--   the other    deleted
--
-- WHY THE FILLS ARE TAKEN WHOLE. The two rows describe the SAME trade, not two
-- halves of one. Adding the fills together would double the size and invent a
-- P&L nobody traded.
--
-- NO UNDO, deliberately, and the dialog says so in those words. An undo here
-- would mean snapshotting a whole position and its children into a table that
-- exists for nothing else; a merge is reversible by re-importing the file the
-- fills came from, which is where they were read from in the first place.
--
-- SECURITY INVOKER. Every table below carries `FOR ALL TO authenticated USING
-- (user_id = auth.uid())`, so RLS scopes each statement to the caller. A row the
-- caller cannot see is indistinguishable from one that does not exist, and both
-- are a refusal.
--
-- The field list is not invented here: `src/lib/journal/merge-positions.ts`
-- exports it, and `merge-positions.test.ts` asserts this function against that
-- export, so the two cannot drift into two answers to one question.
--
-- VERIFIED against the live database, in a transaction that was rolled back.
-- Two rows on one account: a typed one (grade B, thesis, plan 100/95, tag FVG,
-- custom {a:1}, a 999×9 fill) and an imported one (target 120, override −250,
-- tag BOS, custom {b:2}, a 101×1 fill). After the merge: one position left, no
-- orphaned fills, the survivor holding `101x1/import` alone, grade B and the
-- thesis untouched, plan 100/95 with the target 120 filled in, the override
-- −250 and the status `closed` following the fills, tags `FVG+BOS`, and custom
-- `{a:1, b:2}`.

CREATE OR REPLACE FUNCTION public.tj_merge_positions(
  p_keep       uuid,
  p_fills_from uuid
) RETURNS void
  LANGUAGE plpgsql
  SET search_path TO ''
AS $function$
DECLARE
  v_keep  record;
  v_other record;
BEGIN
  IF p_keep = p_fills_from THEN
    RAISE EXCEPTION 'A trade cannot be merged into itself.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT * INTO v_keep  FROM public.tj_positions WHERE id = p_keep;
  SELECT * INTO v_other FROM public.tj_positions WHERE id = p_fills_from;

  IF v_keep.id IS NULL OR v_other.id IS NULL THEN
    RAISE EXCEPTION 'Trade not found.' USING ERRCODE = 'no_data_found';
  END IF;

  -- The same three refusals `mergeRefusal` makes in the dialog, restated where
  -- they are enforced. A client that skipped the dialog is not a reason to
  -- destroy a trade.
  IF v_keep.instrument IS DISTINCT FROM v_other.instrument THEN
    RAISE EXCEPTION 'Different instruments are not one trade.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF lower(COALESCE(v_keep.direction, '')) IS DISTINCT FROM lower(COALESCE(v_other.direction, '')) THEN
    RAISE EXCEPTION 'A long and a short are not one trade.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_keep.account_id IS DISTINCT FROM v_other.account_id THEN
    RAISE EXCEPTION 'These trades are on two different accounts.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- 1) Fills, whole ------------------------------------------------------------
  DELETE FROM public.tj_executions WHERE position_id = p_keep;
  UPDATE public.tj_executions SET position_id = p_keep WHERE position_id = p_fills_from;

  -- 2) Children with a unique key per position ---------------------------------
  --
  -- Each of these three has a UNIQUE (position_id, <something>), so a row can
  -- only move across when the survivor has nothing under that key. The rest go
  -- with the delete at the end — the survivor's own answer wins, because it is
  -- the one whose judgement is being kept.
  UPDATE public.tj_trade_images i
     SET position_id = p_keep
   WHERE i.position_id = p_fills_from
     AND NOT EXISTS (
       SELECT 1 FROM public.tj_trade_images k
        WHERE k.position_id = p_keep AND k.kind = i.kind
     );

  UPDATE public.tj_position_rules r
     SET position_id = p_keep
   WHERE r.position_id = p_fills_from
     AND NOT EXISTS (
       SELECT 1 FROM public.tj_position_rules k
        WHERE k.position_id = p_keep AND k.rule_id = r.rule_id
     );

  -- A check-in on a LOCKED day cannot move, and its guard raises rather than
  -- skipping. That is the right answer: a locked day is a day the trader
  -- declared finished, and this transaction stops instead of half-merging.
  UPDATE public.tj_position_checkins c
     SET position_id = p_keep
   WHERE c.position_id = p_fills_from
     AND NOT EXISTS (
       SELECT 1 FROM public.tj_position_checkins k
        WHERE k.position_id = p_keep AND k.report_date = c.report_date
     );

  UPDATE public.tj_notes       SET position_id = p_keep WHERE position_id = p_fills_from;
  UPDATE public.tj_import_rows SET matched_position_id = p_keep WHERE matched_position_id = p_fills_from;

  -- 3) The surviving row -------------------------------------------------------
  --
  -- Money follows the fills, including to NULL: an override describing fills
  -- that are no longer here is a wrong number presented as fact. The instrument
  -- snapshot travels with it for the same reason — it is what those fills were
  -- priced with.
  UPDATE public.tj_positions k SET
    status                  = v_other.status,
    needs_review            = v_other.needs_review,
    gross_pnl_override      = v_other.gross_pnl_override,
    point_value_at_trade    = COALESCE(v_other.point_value_at_trade, k.point_value_at_trade),
    tick_size_at_trade      = COALESCE(v_other.tick_size_at_trade, k.tick_size_at_trade),
    quote_currency_at_trade = COALESCE(v_other.quote_currency_at_trade, k.quote_currency_at_trade),
    fx_rate_at_trade        = COALESCE(v_other.fx_rate_at_trade, k.fx_rate_at_trade),

    -- Plan and judgement: completed, never overwritten.
    entry_price         = COALESCE(k.entry_price, v_other.entry_price),
    stop_price          = COALESCE(k.stop_price, v_other.stop_price),
    target_price        = COALESCE(k.target_price, v_other.target_price),
    risk_pct            = COALESCE(k.risk_pct, v_other.risk_pct),
    planned_rr          = COALESCE(k.planned_rr, v_other.planned_rr),
    position_size       = COALESCE(k.position_size, v_other.position_size),
    setup_grade         = COALESCE(k.setup_grade, v_other.setup_grade),
    conviction          = COALESCE(k.conviction, v_other.conviction),
    execution_rating    = COALESCE(k.execution_rating, v_other.execution_rating),
    exit_reason         = COALESCE(k.exit_reason, v_other.exit_reason),
    thesis              = COALESCE(k.thesis, v_other.thesis),
    invalidation        = COALESCE(k.invalidation, v_other.invalidation),
    time_stop_days      = COALESCE(k.time_stop_days, v_other.time_stop_days),
    scale_out_plan      = COALESCE(k.scale_out_plan, v_other.scale_out_plan),
    trade_journal_notes = COALESCE(k.trade_journal_notes, v_other.trade_journal_notes),
    playbook_id         = COALESCE(k.playbook_id, v_other.playbook_id),
    miss_reason         = COALESCE(k.miss_reason, v_other.miss_reason),
    missed_at           = COALESCE(k.missed_at, v_other.missed_at),
    max_drawdown_price  = COALESCE(k.max_drawdown_price, v_other.max_drawdown_price),
    max_profit_price    = COALESCE(k.max_profit_price, v_other.max_profit_price),

    -- Tags: two lists about one trade are one list, deduped and without empties.
    mistake = ARRAY(
      SELECT DISTINCT t FROM unnest(k.mistake || v_other.mistake) AS t WHERE t <> ''
    ),
    technical_tags = ARRAY(
      SELECT DISTINCT t FROM unnest(k.technical_tags || v_other.technical_tags) AS t WHERE t <> ''
    ),
    psychology_tags = ARRAY(
      SELECT DISTINCT t FROM unnest(k.psychology_tags || v_other.psychology_tags) AS t WHERE t <> ''
    ),

    -- User-defined fields: the survivor's answers win key by key.
    custom = v_other.custom || k.custom,
    -- A ladder is a plan, so it is completed rather than merged: two ladders for
    -- one trade would add up to more than the trade.
    scale_out_levels = CASE
      WHEN jsonb_array_length(COALESCE(k.scale_out_levels, '[]'::jsonb)) > 0
        THEN k.scale_out_levels
      ELSE COALESCE(v_other.scale_out_levels, '[]'::jsonb)
    END,
    updated_at = now()
  WHERE k.id = p_keep;

  -- 4) And the other one is gone -----------------------------------------------
  DELETE FROM public.tj_positions WHERE id = p_fills_from;
END;
$function$;

REVOKE ALL ON FUNCTION public.tj_merge_positions(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tj_merge_positions(uuid, uuid) TO authenticated;
