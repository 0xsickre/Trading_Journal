-- "Trade Notes" became structurally significant once auto-filing (linking a
-- note to a trade) and the "New trade note" workflow both depend on it
-- existing — deleting it would silently turn both off with no warning.
-- `is_system` marks the one row that must survive. Matching moves to this
-- flag instead of the folder's name, so a rename no longer breaks the
-- automation either — the flag is the durable identity, the name is just a
-- label.

alter table public.tj_note_folders add column if not exists is_system boolean not null default false;

comment on column public.tj_note_folders.is_system is
  'True for the seeded folder automation depends on (currently only "Trade Notes"). Protected from deletion by tj_note_folders_protect_system; not exposed for editing in the UI.';

update public.tj_note_folders set is_system = true where name = 'Trade Notes' and is_system = false;

create or replace function public.tj_protect_system_note_folder()
returns trigger
language plpgsql
as $$
begin
  if old.is_system then
    raise exception 'This folder is required and cannot be deleted.';
  end if;
  return old;
end;
$$;

create trigger tj_note_folders_protect_system
  before delete on public.tj_note_folders
  for each row execute function public.tj_protect_system_note_folder();

-- Fold into the seed so every future signup's "Trade Notes" is flagged from
-- creation, not just backfilled on existing accounts.
create or replace function public.tj_seed_note_folders(target uuid)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if exists (select 1 from public.tj_note_folders where user_id = target) then
    return;
  end if;

  insert into public.tj_note_folders (user_id, name, sort_order, template_text, is_system)
  values
    (target, 'Weekly Review', 0,
E'## Nedelja\n\n### Brojevi\n- Neto P&L:\n- Broj trejdova:\n- Doslednost procesa:\n\n### Šta je radilo\n\n### Šta nije radilo\n\n### Jedan obrazac koji vidim\n\n### Jedna stvar koju menjam sledeće nedelje\n', false),
    (target, 'Trade Notes', 1,
E'## Trejd\n\n### Zašto sam ušao\n\n### Šta je tržište uradilo\n\n### Šta bih uradio drugačije\n', true),
    (target, 'Market Observations', 2,
E'## Zapažanje\n\n### Šta vidim\n\n### Zašto je važno\n\n### Šta bi ga poništilo\n', false);
end;
$function$;

revoke all on function public.tj_seed_note_folders(uuid) from public;
revoke all on function public.tj_seed_note_folders(uuid) from anon;
revoke all on function public.tj_seed_note_folders(uuid) from authenticated;
