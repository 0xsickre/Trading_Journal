-- Two deletions the application never had: removing one account, and putting
-- the whole book back to the state a fresh signup gets.
--
-- WHY THE FIRST ONE CANNOT BE A PLAIN `DELETE FROM tj_accounts`
--
-- `tj_positions.account_id` is ON DELETE SET NULL, and so is
-- `tj_import_batches.account_id`. A delete through PostgREST would therefore
-- remove the account and LEAVE its trades behind with a null account — which is
-- the worst of the three possible outcomes, because it is the silent one. A
-- trade with no account has no currency to convert through: the view reports
-- `fx_rate_source = 'no_account'`, its money stops being comparable with every
-- other trade, and the account it belonged to is gone so nothing on screen says
-- what happened. The account disappears, twenty trades stay, and every number
-- they feed quietly changes.
--
-- Hence the order below, which is the entire point of the function: dependants
-- first, parent last, one transaction.
--
-- WHY SECURITY INVOKER
--
-- Both functions are SECURITY INVOKER (the default), not DEFINER. Every table
-- touched here carries `FOR ALL TO authenticated USING (user_id = auth.uid())`,
-- so RLS already scopes each statement to the caller. A DEFINER version would
-- have to re-derive that scope by hand — which is exactly the hole this schema
-- revoked EXECUTE for on six other functions. The explicit `user_id = v_uid` on
-- every statement is a second belt: it keeps the sweep correct even if one of
-- these were ever run by a role that bypasses RLS.

-- 1) Delete one account, with everything that hangs off it ---------------------

CREATE OR REPLACE FUNCTION public.tj_delete_account(p_account_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path TO ''
AS $$
DECLARE
  v_uid       uuid := (SELECT auth.uid());
  v_remaining int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- RLS already hides other people's rows, so "does not exist" and "is not
  -- yours" collapse into one answer here deliberately — the caller learns
  -- nothing about accounts that are not theirs.
  IF NOT EXISTS (
    SELECT 1 FROM public.tj_accounts
     WHERE id = p_account_id AND user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Account not found'
      USING ERRCODE = 'no_data_found';
  END IF;

  -- The app refuses this too, but the app is not the guard: PostgREST with the
  -- user's JWT is a live write path, and half this schema exists because a
  -- check that lived only in TypeScript was a lock you could walk around.
  -- Everything downstream — the primary account, the timezone every day is
  -- resolved in, the currency, the breakeven band — reads `accounts[0]` and has
  -- no answer for an empty list.
  SELECT count(*) INTO v_remaining
    FROM public.tj_accounts
   WHERE user_id = v_uid AND id <> p_account_id;

  IF v_remaining = 0 THEN
    RAISE EXCEPTION 'The last account cannot be deleted'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Trades first — the FK would SET NULL them instead of removing them.
  -- Cascades from here reach tj_executions, tj_position_rules,
  -- tj_position_checkins and tj_trade_images. Notes that point at one of these
  -- trades keep their text and lose the link (notes.position_id is SET NULL),
  -- which is right: a note is writing, not a derived number.
  DELETE FROM public.tj_positions
   WHERE user_id = v_uid AND account_id = p_account_id;

  -- Same SET NULL story; the batch's rows cascade from the batch.
  DELETE FROM public.tj_import_batches
   WHERE user_id = v_uid AND account_id = p_account_id;

  -- tj_cash_events is the one child that really does cascade from the account,
  -- and is left to it.
  DELETE FROM public.tj_accounts
   WHERE user_id = v_uid AND id = p_account_id;
END;
$$;

-- 2) Reset everything to the fresh-signup state -------------------------------

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

  -- Children before parents. Several of these would be reached by cascade
  -- anyway; naming all 25 keeps the sweep independent of which FK happens to
  -- cascade and which sets null, and makes a table added later a visible
  -- omission from this list rather than a silent survivor of the reset.
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

  -- The sanctioned re-seed: takes no argument and seeds the caller only. The
  -- same function the dashboard already calls when it finds an empty account,
  -- so "reset" and "first ever load" end in provably the same state instead of
  -- two nearly-identical ones.
  PERFORM public.tj_seed_my_defaults();
END;
$$;

-- Grants ----------------------------------------------------------------------
--
-- `anon` is revoked BY NAME, not just via PUBLIC. Supabase's default privileges
-- grant EXECUTE on every new function in `public` to both anon and
-- authenticated at creation time, and `REVOKE ... FROM PUBLIC` does not remove
-- an explicit role grant — so the PUBLIC line alone leaves `anon` holding
-- EXECUTE on a function called "reset my data". Verified against the live
-- project: after the PUBLIC revoke, anon was still listed.
--
-- Neither function would do anything for anon (both raise on a null auth.uid(),
-- and RLS grants an anonymous caller no rows), but a destructive entry point
-- that is merely ineffective is not the same as one that is not exposed.

REVOKE ALL ON FUNCTION public.tj_delete_account(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tj_reset_my_data()      FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tj_delete_account(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.tj_reset_my_data()      FROM anon;

GRANT EXECUTE ON FUNCTION public.tj_delete_account(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tj_reset_my_data()      TO authenticated;
