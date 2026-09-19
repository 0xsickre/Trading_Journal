-- Renaming a tag and deleting a category, each in one transaction.
--
-- `renameOption` called `tj_rename_option_value` (rewrite the trades) and then
-- updated the option row in a second request. If the second failed, every trade
-- carried the new name while the list still offered the old one — the split the
-- cascade exists to prevent. `deleteList` deleted the field definitions and then
-- the list in two requests, so a failure between them left a category with no
-- field. Both are single functions now.
--
-- The app still decides WHICH trade fields a list feeds (the mapping is half
-- TypeScript, see `optionFieldTargets`) and passes them in, exactly as it did to
-- `tj_rename_option_value`, which does the rewrite and whitelists every column.

CREATE OR REPLACE FUNCTION public.tj_rename_option(
  p_item_id uuid,
  p_targets jsonb,
  p_new     text
) RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_old     text;
  v_list    uuid;
  v_new     text := btrim(p_new);
  v_touched integer := 0;
BEGIN
  IF v_new IS NULL OR v_new = '' THEN
    RAISE EXCEPTION 'The name cannot be empty.' USING errcode = 'check_violation';
  END IF;

  -- Under RLS: an item that is not the caller's reads as missing.
  SELECT value, list_id INTO v_old, v_list
    FROM public.tj_option_items
   WHERE id = p_item_id
   FOR UPDATE;
  IF v_old IS NULL THEN
    RAISE EXCEPTION 'Option not found.' USING errcode = 'no_data_found';
  END IF;

  -- Two tags with one name are one tag on every trade that holds either. The app
  -- also checks the sibling list feeding the same column; this is the same-list
  -- half, where the database can see the whole answer.
  IF lower(v_new) <> lower(v_old) AND EXISTS (
    SELECT 1 FROM public.tj_option_items
     WHERE list_id = v_list AND id <> p_item_id AND lower(value) = lower(v_new)
  ) THEN
    RAISE EXCEPTION '"%" already exists in this category.', v_new
      USING errcode = 'unique_violation';
  END IF;

  IF v_new <> v_old THEN
    v_touched := public.tj_rename_option_value(p_targets, v_old, v_new);
  END IF;

  UPDATE public.tj_option_items
     SET label = v_new, value = v_new
   WHERE id = p_item_id;

  RETURN v_touched;
END;
$$;

COMMENT ON FUNCTION public.tj_rename_option(uuid, jsonb, text) IS
  'Renames an option and rewrites the trades that hold it, in one transaction. Refuses a name already in the same list.';
REVOKE ALL ON FUNCTION public.tj_rename_option(uuid, jsonb, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.tj_rename_option(uuid, jsonb, text) TO authenticated;


CREATE OR REPLACE FUNCTION public.tj_delete_list(p_list_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
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
  -- risk_pct, and any list a column-backed definition reads.
  IF v_key IN ('technical_tag', 'exit_reason', 'mistake', 'emotion', 'discipline',
               'miss_reason', 'risk_pct')
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
$$;

COMMENT ON FUNCTION public.tj_delete_list(uuid) IS
  'Deletes a category and the field definitions that read it, in one transaction. Refuses the lists built-in trade fields read.';
REVOKE ALL ON FUNCTION public.tj_delete_list(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.tj_delete_list(uuid) TO authenticated;
