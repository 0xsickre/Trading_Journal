-- M9: allocate option sort_order atomically.
--
-- addOption() and addList() read MAX(sort_order) in one request and inserted in
-- the next. Two adds issued close together both read the same maximum and both
-- wrote the same ordinal, leaving the list in an order that depends on which
-- row the planner happens to return first.
--
-- Computing the ordinal inside the INSERT collapses that to a single statement,
-- so the read and the write can no longer be separated by a network round trip.
--
-- Deliberately no UNIQUE(list_id, sort_order): existing data may already carry
-- duplicates from the old path, and a constraint would turn a cosmetic ordering
-- glitch into a hard insert failure. The reader breaks ties on created_at, id
-- instead, so ordering is deterministic either way.

CREATE OR REPLACE FUNCTION public.tj_add_option_item(
  p_list_id uuid,
  p_label   text
) RETURNS public.tj_option_items
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_label   text := btrim(p_label);
  v_row     public.tj_option_items;
BEGIN
  IF v_label = '' THEN
    RAISE EXCEPTION 'Value cannot be empty.' USING ERRCODE = 'check_violation';
  END IF;

  -- RLS hides other users' lists, so an invisible list and a missing one are
  -- the same refusal.
  SELECT user_id INTO v_user_id
    FROM public.tj_option_lists
   WHERE id = p_list_id;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'List not found.' USING ERRCODE = 'no_data_found';
  END IF;

  INSERT INTO public.tj_option_items (user_id, list_id, value, label, sort_order)
  SELECT
    v_user_id,
    p_list_id,
    v_label,
    v_label,
    COALESCE(max(i.sort_order), -1) + 1
  FROM public.tj_option_items i
  WHERE i.list_id = p_list_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.tj_add_option_list(
  p_key      text,
  p_label    text,
  p_category text DEFAULT NULL
) RETURNS public.tj_option_lists
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_key   text := btrim(p_key);
  v_label text := btrim(p_label);
  v_row   public.tj_option_lists;
BEGIN
  IF v_key = '' OR v_label = '' THEN
    RAISE EXCEPTION 'Key and label are required.' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.tj_option_lists (user_id, key, label, category, sort_order)
  SELECT
    (SELECT auth.uid()),
    v_key,
    v_label,
    p_category,
    COALESCE(max(l.sort_order), -1) + 1
  FROM public.tj_option_lists l
  WHERE l.user_id = (SELECT auth.uid())
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.tj_add_option_item(uuid, text) FROM public;
REVOKE ALL ON FUNCTION public.tj_add_option_list(text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.tj_add_option_item(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tj_add_option_list(text, text, text) TO authenticated, service_role;
