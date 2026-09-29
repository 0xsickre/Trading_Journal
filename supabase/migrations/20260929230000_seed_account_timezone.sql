-- K5, the seed: a new book's first account opens in the trader's zone.
--
-- 20260929210000 moved the column default and every existing account to Europe/Belgrade, but
-- `tj_seed_defaults` names the zone itself, so a reset book would have come back in New York.
-- Restated from its live definition with that one value changed; `create or replace` keeps the
-- privileges.

CREATE OR REPLACE FUNCTION public.tj_seed_defaults(target uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not exists (select 1 from public.tj_accounts where user_id = target) then
    insert into public.tj_accounts (user_id, name, currency, starting_balance, default_asset_class, timezone)
    values (target, 'Main Account', 'USD', 0, 'Futures', 'Europe/Belgrade');
  end if;

  perform public.tj_seed_categories(target);
  perform public.tj_seed_instruments_defaults(target);
  perform public.tj_seed_playbooks(target);
  perform public.tj_seed_tracker_rules(target);
  perform public.tj_seed_note_folders(target);
end;
$function$;
