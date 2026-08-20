-- =============================================================================
-- ROLLBACK for 20260821120000_bot_ingest.sql
--
-- NOT a migration. Nothing runs this automatically; it exists because the
-- forward migration was applied straight to the production database rather than
-- to a branch, and an irreversible change to a live book is not a change, it is
-- a gamble.
--
-- Run the whole thing in ONE transaction. Applying half of this leaves
-- tj_positions carrying 'bot' rows under a constraint that no longer allows
-- 'bot', which fails on the next write to any of them.
--
-- WHAT IT DESTROYS
-- Every trade the bridge recorded, and the log of what the bot sent. That is
-- deliberate: the source CHECK cannot go back to ('manual','import') while rows
-- say 'bot', and silently rewriting those rows to 'manual' would be worse --
-- it would claim a human typed trades that a machine did.
--
-- Count them before deciding:
--   SELECT count(*) FROM public.tj_positions WHERE source = 'bot';
--
-- If that number is not zero and the trades matter, do NOT run this. Fix
-- forward instead: revoke the bot token in Settings, which stops the bridge
-- dead while leaving every row and every constraint intact.
-- =============================================================================

BEGIN;

-- 1) Bot-written trades. Fills, rule answers and images cascade from the
--    position; tj_bot_events.position_id is ON DELETE SET NULL and the table
--    goes away below anyway.
DELETE FROM public.tj_positions WHERE source = 'bot';

-- Any fill written by the bridge onto a trade that survived -- possible only if
-- a human edited the position's source afterwards. Left as a separate statement
-- rather than assumed impossible.
DELETE FROM public.tj_executions WHERE source = 'bot';

-- 2) The function, before the tables it reads.
DROP FUNCTION IF EXISTS public.tj_bot_ingest(text, jsonb);

-- 3) Tables. tj_bot_events references tj_bot_tokens, so order matters.
DROP TABLE IF EXISTS public.tj_bot_events;
DROP TABLE IF EXISTS public.tj_bot_tokens;
DROP TABLE IF EXISTS public.tj_broker_symbol_map;

-- 4) Correlation columns and their partial indexes (dropped with the columns).
ALTER TABLE public.tj_positions
  DROP COLUMN IF EXISTS broker,
  DROP COLUMN IF EXISTS broker_account,
  DROP COLUMN IF EXISTS broker_order_id,
  DROP COLUMN IF EXISTS broker_position_id;

DROP INDEX IF EXISTS public.tj_accounts_broker_account_key;
ALTER TABLE public.tj_accounts DROP COLUMN IF EXISTS broker_account_id;

-- 5) Narrow the provenance CHECKs back. This is why step 1 had to delete rows.
ALTER TABLE public.tj_positions DROP CONSTRAINT IF EXISTS tj_positions_source_check;
ALTER TABLE public.tj_positions ADD CONSTRAINT tj_positions_source_check
  CHECK (source = ANY (ARRAY['manual'::text, 'import'::text]));

ALTER TABLE public.tj_executions DROP CONSTRAINT IF EXISTS tj_executions_source_check;
ALTER TABLE public.tj_executions ADD CONSTRAINT tj_executions_source_check
  CHECK (source = ANY (ARRAY['manual'::text, 'import'::text]));

-- 6) Restore tj_reset_my_data without the three bridge tables. Body is
--    otherwise identical to 20260817120000_delete_account_and_reset.sql.
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

  DELETE FROM public.tj_position_rules      WHERE user_id = v_uid;
  DELETE FROM public.tj_position_checkins   WHERE user_id = v_uid;
  DELETE FROM public.tj_trade_images        WHERE user_id = v_uid;
  DELETE FROM public.tj_executions          WHERE user_id = v_uid;
  DELETE FROM public.tj_import_rows         WHERE user_id = v_uid;
  DELETE FROM public.tj_positions           WHERE user_id = v_uid;
  DELETE FROM public.tj_import_batches      WHERE user_id = v_uid;
  DELETE FROM public.tj_playbook_rule_links WHERE user_id = v_uid;
  DELETE FROM public.tj_playbook_rules      WHERE user_id = v_uid;
  DELETE FROM public.tj_playbooks           WHERE user_id = v_uid;
  DELETE FROM public.tj_tracker_checkins    WHERE user_id = v_uid;
  DELETE FROM public.tj_tracker_rules       WHERE user_id = v_uid;
  DELETE FROM public.tj_daily_reports       WHERE user_id = v_uid;
  DELETE FROM public.tj_weekly_reviews      WHERE user_id = v_uid;
  DELETE FROM public.tj_focus_goals         WHERE user_id = v_uid;
  DELETE FROM public.tj_notes               WHERE user_id = v_uid;
  DELETE FROM public.tj_note_folders        WHERE user_id = v_uid;
  DELETE FROM public.tj_note_tags           WHERE user_id = v_uid;
  DELETE FROM public.tj_cash_events         WHERE user_id = v_uid;
  DELETE FROM public.tj_accounts            WHERE user_id = v_uid;
  DELETE FROM public.tj_option_items        WHERE user_id = v_uid;
  DELETE FROM public.tj_option_lists        WHERE user_id = v_uid;
  DELETE FROM public.tj_field_defs          WHERE user_id = v_uid;
  DELETE FROM public.tj_instruments         WHERE user_id = v_uid;
  DELETE FROM public.tj_user_prefs          WHERE user_id = v_uid;

  PERFORM public.tj_seed_my_defaults();
END;
$$;

REVOKE ALL ON FUNCTION public.tj_reset_my_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tj_reset_my_data() TO authenticated;

COMMIT;

-- After this, revert the application code too, or every account read fails:
--   git reset --hard pre-bot-sync
-- getAccounts() selects broker_account_id, which no longer exists.
