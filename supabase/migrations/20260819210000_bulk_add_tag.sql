-- Bulk-tag N trades in one round trip. PostgREST's `.update()` cannot express
-- "append this value to an array column, deduped, across many rows" — that
-- needs `array_append`-style set logic, hence an RPC rather than a plain
-- update() call from the server action.
--
-- No `security definer`: the default `security invoker` means the UPDATE
-- inside still runs as the calling user, so RLS (`tj_positions_owner`) applies
-- exactly as it would to a direct `.update()` call — same ownership guarantee,
-- no elevated privilege needed for what is fundamentally the user editing
-- their own rows.
--
-- Branches on `p_kind` are static column references, not `format()`/EXECUTE —
-- there is no dynamic SQL here, so there is nothing for an attacker-controlled
-- string to inject into.

create or replace function public.tj_bulk_add_tag(p_ids uuid[], p_kind text, p_values text[])
returns void
language plpgsql
as $$
begin
  if p_kind = 'technical' then
    update public.tj_positions
    set technical_tags = array(select distinct unnest(technical_tags || p_values))
    where id = any(p_ids);
  elsif p_kind = 'psychology' then
    update public.tj_positions
    set psychology_tags = array(select distinct unnest(psychology_tags || p_values))
    where id = any(p_ids);
  elsif p_kind = 'mistake' then
    update public.tj_positions
    set mistake = array(select distinct unnest(mistake || p_values))
    where id = any(p_ids);
  else
    raise exception 'unknown tag kind: %', p_kind;
  end if;
end;
$$;

grant execute on function public.tj_bulk_add_tag(uuid[], text, text[]) to authenticated;
revoke all on function public.tj_bulk_add_tag(uuid[], text, text[]) from anon;
revoke all on function public.tj_bulk_add_tag(uuid[], text, text[]) from public;
