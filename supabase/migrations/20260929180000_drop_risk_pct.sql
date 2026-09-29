-- H2.4b: the "Risk %" choice leaves the book (decision 29.09.2026, I4).
--
-- WHY. `tj_positions.risk_pct` was a dropdown of the share of equity a trade
-- meant to risk, and it sized the trade on a non-Topstep account. Since F3 a
-- Topstep future is sized by the account's risk rule (a share of the room
-- above the MLL, `computeTopstepRisk`), and since H1 the book is Topstep only,
-- so the field was hidden on every trade the trader can open. On 29.09.2026 no
-- trade and no playbook carried a value. With it go the playbook's
-- `default_risk_pct` (it only prefilled the field), the "Risk %" list and its
-- four items, and the `risk_intent_gap` report metric (code only).
--
-- ORDER. `tj_merge_positions` names the column, so it is restated first, from
-- 20260929150000 without the one line. `tj_delete_list` and
-- `tj_seed_categories` name the list: restated from their LIVE definitions
-- without it. `CREATE OR REPLACE` keeps their grants. Then the data and the
-- columns go.

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
  -- Each of these two has a UNIQUE (position_id, <something>), so a row can
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
    planned_rr          = COALESCE(k.planned_rr, v_other.planned_rr),
    position_size       = COALESCE(k.position_size, v_other.position_size),
    execution_rating    = COALESCE(k.execution_rating, v_other.execution_rating),
    exit_reason         = COALESCE(k.exit_reason, v_other.exit_reason),
    thesis              = COALESCE(k.thesis, v_other.thesis),
    invalidation        = COALESCE(k.invalidation, v_other.invalidation),
    time_stop           = COALESCE(k.time_stop, v_other.time_stop),
    scale_out_plan      = COALESCE(k.scale_out_plan, v_other.scale_out_plan),
    trade_journal_notes = COALESCE(k.trade_journal_notes, v_other.trade_journal_notes),
    playbook_id         = COALESCE(k.playbook_id, v_other.playbook_id),
    miss_reason         = COALESCE(k.miss_reason, v_other.miss_reason),
    missed_at           = COALESCE(k.missed_at, v_other.missed_at),
    max_drawdown_price  = COALESCE(k.max_drawdown_price, v_other.max_drawdown_price),
    max_profit_price    = COALESCE(k.max_profit_price, v_other.max_profit_price),
    equity_at_entry     = COALESCE(k.equity_at_entry, v_other.equity_at_entry),

    -- The seal travels with the SURVIVING trade and is never taken from the
    -- other one: a plan this trade never made is not its plan. Without these
    -- three lines the COALESCE list above would quietly move a sealed plan —
    -- at the one place nobody looks.
    plan_snapshot       = k.plan_snapshot,
    plan_sealed_at      = k.plan_sealed_at,
    plan_amended_at     = k.plan_amended_at,

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

CREATE OR REPLACE FUNCTION public.tj_delete_list(p_list_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key text;
BEGIN
  SELECT key INTO v_key
    FROM public.tj_option_lists
   WHERE id = p_list_id
   FOR UPDATE;
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'Category not found.' USING errcode = 'no_data_found';
  END IF;

  -- The same protection the app applies (`listProtection`), restated here so a
  -- direct call cannot empty the dropdown of a trade column: the seeded lists,
  -- and any list a column-backed definition reads.
  IF v_key IN ('technical_tag', 'exit_reason', 'mistake', 'emotion', 'discipline',
               'miss_reason')
     OR EXISTS (
       SELECT 1 FROM public.tj_field_defs
        WHERE list_key = v_key
          AND key IN ('technical_tags', 'mistake', 'psychology_tags', 'exit_reason', 'miss_reason')
     ) THEN
    RAISE EXCEPTION 'This category feeds a built-in trade field and cannot be deleted.'
      USING errcode = 'check_violation';
  END IF;

  DELETE FROM public.tj_field_defs WHERE list_key = v_key;
  -- Items go with the list (ON DELETE CASCADE). Trades keep their text.
  DELETE FROM public.tj_option_lists WHERE id = p_list_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tj_seed_categories(target uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not exists (select 1 from public.tj_option_lists where user_id = target) then
    insert into public.tj_option_lists (user_id, key, label, category, sort_order)
    select target, v.key, v.label, v.category, v.sort_order
    from (values
      ('direction','Direction','Context',0),
      ('htf_bias','Bias dana (brief)','Context',1),
      ('entry_tf','Entry TF','Context',2),
      ('technical_tag','Technical Tags','ICT Setup',3),
      ('setup_grade','Setup Grade','ICT Setup',4),
      ('exit_reason','Exit Reason','Risk',5),
      ('miss_reason','Miss Reason','Risk',6),
      ('emotion','Emotion','Psychology',7),
      ('discipline','Discipline','Psychology',8),
      ('mistake','Mistake','Psychology',9)
    ) as v(key, label, category, sort_order);

    insert into public.tj_option_items (user_id, list_id, value, label, sort_order)
    select target, l.id, v.value, v.value, v.ord
    from (values
      ('direction','Long',0),('direction','Short',1),
      ('htf_bias','Long',0),('htf_bias','Short',1),('htf_bias','Neutral',2),
      ('entry_tf','1m',0),('entry_tf','2m',1),('entry_tf','5m',2),('entry_tf','15m',3),
      ('technical_tag','Liquidity sweep',0),('technical_tag','MSS',1),('technical_tag','FVG',2),
      ('technical_tag','iFVG',3),('technical_tag','Order block',4),('technical_tag','Breaker',5),
      ('technical_tag','OTE',6),('technical_tag','SMT divergence',7),('technical_tag','HTF rejection close',8),
      ('setup_grade','A+',0),('setup_grade','A',1),('setup_grade','B',2),('setup_grade','C',3),
      ('exit_reason','Target hit',0),('exit_reason','Stop hit',1),('exit_reason','Breakeven',2),
      ('exit_reason','Trailing stop',3),('exit_reason','Closed early',4),('exit_reason','Time exit',5),
      ('exit_reason','Flat by close',6),
      ('miss_reason','No fill',0),('miss_reason','Hesitated',1),('miss_reason','Not at screen',2),
      ('miss_reason','Skipped by rules',3),('miss_reason','News / event',4),
      ('emotion','Calm',0),('emotion','FOMO',1),('emotion','Fear',2),('emotion','Revenge',3),
      ('emotion','Impatient',4),('emotion','Overconfident',5),('emotion','Tired',6),
      ('discipline','Followed plan',0),('discipline','Respected risk',1),('discipline','Managed by plan',2),
      ('mistake','No mistake',0),('mistake','Early entry',1),('mistake','Chased price',2),
      ('mistake','Moved stop',3),('mistake','Cut winner early',4),('mistake','Oversized',5),
      ('mistake','Overtrading',6),('mistake','Trade after DLL plan',7),('mistake','Revenge re-entry',8),
      ('mistake','Traded red window',9)
    ) as v(list_key, value, ord)
    join public.tj_option_lists l on l.user_id = target and l.key = v.list_key;

    insert into public.tj_field_defs (user_id, key, label, field_type, list_key, show_phase, sort_order)
    select target, v.key, v.label, v.field_type, v.list_key, v.show_phase, v.ord
    from (values
      ('htf_bias',        'Bias dana (brief)', 'select', 'htf_bias',    'always', 0),
      ('entry_tf',        'Entry TF',        'select', 'entry_tf',      'always', 1),
      ('technical_tags',  'Technical Tags',  'tags',   'technical_tag', 'always', 2),
      ('exit_reason',     'Exit Reason',     'select', 'exit_reason',   'active', 3),
      ('mistake',         'Mistake',         'tags',   'mistake',       'active', 4),
      ('psychology_tags', 'Psychology tags', 'tags',   'emotion',       'active', 5),
      ('miss_reason',     'Miss Reason',     'select', 'miss_reason',   'missed', 6)
    ) as v(key, label, field_type, list_key, show_phase, ord)
    on conflict (user_id, key) do nothing;
  end if;
end;
$function$;

-- The list and its items (items cascade), and the columns.
DELETE FROM public.tj_option_lists WHERE key = 'risk_pct';

ALTER TABLE public.tj_positions DROP COLUMN IF EXISTS risk_pct;

ALTER TABLE public.tj_playbooks DROP CONSTRAINT IF EXISTS tj_playbooks_default_risk_pct_check;
ALTER TABLE public.tj_playbooks DROP COLUMN IF EXISTS default_risk_pct;
