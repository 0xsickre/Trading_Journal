-- Renaming an option rewrites the trades that carry it.
--
-- THE BUG THIS CLOSES. `renameOption` wrote both `label` and `value` on
-- `tj_option_items` and stopped there. But a trade does not point at an option
-- row — it stores the option's VALUE as text, in a column or in the `custom`
-- bag. So renaming "FVG" to "Fair Value Gap" left every trade tagged "FVG"
-- pointing at a string no list supplied any more: the option vanished from the
-- report dimension's bucket order, and the trades fell into an "other" bucket
-- beside the renamed one. The history silently split in two.
--
-- The trader's answer to what a rename means was unambiguous: it is the same
-- thing under a new name, so the trades come along.
--
-- WHY AN RPC AND NOT A LOOP IN THE SERVER ACTION. Two of the targets are
-- `text[]` columns (`technical_tags`, `psychology_tags`) and tag fields in the
-- `custom` bag are jsonb arrays. Rewriting one element of those from the app
-- means read-modify-write, which is both racy and subject to PostgREST's
-- 1000-row cap — a trader with more than a thousand trades on one tag would
-- have the tail silently left behind. `array_replace` and a jsonb rebuild do it
-- in one statement, over every row, atomically.
--
-- WHY THE TARGETS COME FROM THE APP. Which field reads which list is decided by
-- `form-config.ts` merged with `tj_field_defs` — the built-in half of that
-- mapping exists only in TypeScript. The database cannot derive it, so it is
-- passed in. That makes the column name user-influenced, which is why every
-- column target is checked against `information_schema` below before it reaches
-- dynamic SQL: an unknown name raises rather than executes.

CREATE OR REPLACE FUNCTION public.tj_rename_option_value(
  p_targets jsonb,
  p_old text,
  p_new text
) RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  t          jsonb;
  col        text;
  is_custom  boolean;
  is_array   boolean;
  touched    integer := 0;
  affected   integer;
BEGIN
  IF p_old IS NULL OR p_new IS NULL OR p_old = p_new THEN
    RETURN 0;
  END IF;
  IF jsonb_typeof(p_targets) <> 'array' THEN
    RAISE EXCEPTION 'p_targets must be an array.' USING errcode = 'check_violation';
  END IF;

  FOR t IN SELECT * FROM jsonb_array_elements(p_targets) LOOP
    col       := t ->> 'key';
    is_custom := coalesce((t ->> 'custom')::boolean, false);
    is_array  := coalesce((t ->> 'array')::boolean, false);

    IF col IS NULL OR col = '' THEN
      CONTINUE;
    END IF;

    IF is_custom THEN
      -- A key inside the `custom` jsonb bag. The key is interpolated into a
      -- jsonb path, never into an identifier, so it cannot become SQL — but it
      -- is still passed as a parameter rather than concatenated.
      IF is_array THEN
        UPDATE public.tj_positions
           SET custom = jsonb_set(
                 custom,
                 array[col],
                 (SELECT coalesce(jsonb_agg(
                           CASE WHEN e #>> '{}' = p_old
                                THEN to_jsonb(p_new)
                                ELSE e END), '[]'::jsonb)
                    FROM jsonb_array_elements(custom -> col) e))
         WHERE jsonb_typeof(custom -> col) = 'array'
           AND custom -> col @> to_jsonb(array[p_old]);
      ELSE
        UPDATE public.tj_positions
           SET custom = jsonb_set(custom, array[col], to_jsonb(p_new))
         WHERE custom ->> col = p_old;
      END IF;

      GET DIAGNOSTICS affected = ROW_COUNT;
      touched := touched + affected;
      CONTINUE;
    END IF;

    -- A real column. Whitelisted against the catalogue before it is quoted into
    -- dynamic SQL: this is the only place a caller-supplied string becomes an
    -- identifier, so an unknown name must stop here rather than run.
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'tj_positions'
         AND column_name = col
    ) THEN
      RAISE EXCEPTION 'Unknown column %.', col USING errcode = 'check_violation';
    END IF;

    IF is_array THEN
      EXECUTE format(
        'UPDATE public.tj_positions SET %1$I = array_replace(%1$I, $1, $2) WHERE $1 = ANY(%1$I)',
        col
      ) USING p_old, p_new;
    ELSE
      EXECUTE format(
        'UPDATE public.tj_positions SET %1$I = $2 WHERE %1$I = $1',
        col
      ) USING p_old, p_new;
    END IF;

    GET DIAGNOSTICS affected = ROW_COUNT;
    touched := touched + affected;
  END LOOP;

  RETURN touched;
END;
$$;

-- SECURITY INVOKER, so RLS on tj_positions still applies and the function can
-- only ever rewrite the caller's own trades. Nothing here needs to reach across
-- users, and a definer function that could would be a much larger promise than
-- a rename needs to make.
COMMENT ON FUNCTION public.tj_rename_option_value(jsonb, text, text) IS
  'Rewrites one option value across the trade fields fed by its list. Targets come from the app because the field-to-list mapping is half TypeScript; column names are whitelisted against information_schema before reaching dynamic SQL.';

REVOKE ALL ON FUNCTION public.tj_rename_option_value(jsonb, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.tj_rename_option_value(jsonb, text, text) TO authenticated;
