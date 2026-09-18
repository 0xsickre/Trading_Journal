-- The cTrader bot bridge is removed. The trading moves to MT4/MT5, and a bridge
-- that only speaks cTrader is then a surface nobody uses: an anon-executable
-- ingest function, a token table and three tables of state, all of which have to
-- stay correct for a broker this journal no longer talks to.
--
-- WHAT SURVIVES. Every trade and every fill. Rows the bridge wrote become
-- ordinary manual ones — they are as true as when they arrived, and their
-- provenance is now only in the migration record. What goes is the machinery:
-- tokens, the event log, symbol mapping, and the broker ids that only the bridge
-- ever set or read.
--
-- WHAT THIS COSTS, said plainly. `tj_bot_events` is the only record of what the
-- bridge received and quarantined, and this deletes it. It is not needed to
-- explain any trade — the trade itself carries its fills — but it cannot be
-- reconstructed either.
--
-- MAE/MFE. `excursion_source` existed to tell a price the bot measured from one
-- a human typed. With the bridge gone, every excursion is typed, so the column
-- says nothing. Its guard trigger goes with it. The open question this leaves —
-- where MAE/MFE comes from on MT4/MT5 — is recorded in README § "Blocked, not
-- rejected" and ROADMAP § Faza 8B, and `excursion-scan.ts` still stands ready:
-- it takes candles, and never cared which broker they came from.
--
-- ORDER. Data first, then the function that reads the tables, then the trigger,
-- then the tables, then the columns, and only then the CHECKs that the data no
-- longer violates. Dropping a column takes its indexes and its constraint with
-- it, so those are not listed separately.

-- 1) Bot-written rows become manual ------------------------------------------
--
-- Before narrowing the CHECK, or the constraint would be rejected by the rows
-- it is meant to describe.

UPDATE public.tj_positions  SET source = 'manual' WHERE source = 'bot';
UPDATE public.tj_executions SET source = 'manual' WHERE source = 'bot';

-- 2) Functions ----------------------------------------------------------------
--
-- `tj_bot_ingest` is the bridge's whole API: one anon-executable function behind
-- a token. `tj_status_from_executions` was written for it and has no other
-- caller — the application computes status in `trade-lifecycle.ts`.

DROP FUNCTION IF EXISTS public.tj_bot_ingest(text, jsonb);
DROP FUNCTION IF EXISTS public.tj_status_from_executions(uuid, text);

DROP TRIGGER IF EXISTS tj_positions_excursion_source ON public.tj_positions;
DROP FUNCTION IF EXISTS public.tj_excursion_source_guard();

-- 3) Tables -------------------------------------------------------------------

DROP TABLE IF EXISTS public.tj_bot_events;
DROP TABLE IF EXISTS public.tj_bot_tokens;
DROP TABLE IF EXISTS public.tj_broker_symbol_map;

-- 4) Columns ------------------------------------------------------------------
--
-- `tj_accounts.broker` stays: it is the free-text broker label on the account,
-- it predates the bridge and Settings still writes it. `broker_account_id` was
-- its machine-readable half, and only the bridge read that.

ALTER TABLE public.tj_positions
  DROP COLUMN IF EXISTS broker,
  DROP COLUMN IF EXISTS broker_account,
  DROP COLUMN IF EXISTS broker_order_id,
  DROP COLUMN IF EXISTS broker_position_id,
  DROP COLUMN IF EXISTS excursion_source;

ALTER TABLE public.tj_accounts
  DROP COLUMN IF EXISTS broker_account_id;

-- 5) The source vocabulary is back to what writes into it ----------------------

ALTER TABLE public.tj_positions DROP CONSTRAINT IF EXISTS tj_positions_source_check;
ALTER TABLE public.tj_positions ADD CONSTRAINT tj_positions_source_check
  CHECK (source = ANY (ARRAY['manual'::text, 'import'::text]));

ALTER TABLE public.tj_executions DROP CONSTRAINT IF EXISTS tj_executions_source_check;
ALTER TABLE public.tj_executions ADD CONSTRAINT tj_executions_source_check
  CHECK (source = ANY (ARRAY['manual'::text, 'import'::text]));

-- 6) The reset list loses three tables ----------------------------------------
--
-- Restated in full rather than patched, for the reason 20260817120000 gave when
-- it chose a hand-written list over a catalog loop: the list IS the record of
-- what "reset everything" means, and a reader must be able to read it whole.

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
  DELETE FROM public.tj_playbook_sections   WHERE user_id = v_uid;
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
  DELETE FROM public.tj_dashboard_templates WHERE user_id = v_uid;
  DELETE FROM public.tj_user_prefs          WHERE user_id = v_uid;

  PERFORM public.tj_seed_my_defaults();
END;
$$;

COMMENT ON FUNCTION public.tj_reset_my_data() IS
  'Deletes all 27 tj_ tables for the caller, then re-seeds defaults. Table list is maintained by hand — add new tables here.';

REVOKE ALL ON FUNCTION public.tj_reset_my_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tj_reset_my_data() TO authenticated;
