-- Faza X9 (26.10.2026): journal ne čita brief (X-10).
--
-- ZAŠTO. Trejder: „Brief treba da bude brief za tržište, ne za journal“ — brief u futures-trading više ne upisuje
-- `tj_session_briefs` (crveni prozori, rano zatvaranje, raspon). Pravilo „Bez ulaza u crvenom prozoru vesti (brief)“
-- nema više po čemu da oceni.
--
-- ŠTA.
--   * `no_entry_in_red_window` se PENZIONIŠE (`deleted_at`), kao novčana pravila u X1: zaključani dani čuvaju
--     zamrznute ocene, pa red i ključ u CHECK-u ostaju.
--   * Fabrička lista (`tj_seed_tracker_rules`, nova knjiga) bez tog pravila.
--   * `tj_session_briefs` i njeni redovi ostaju kao istorija; journal ih više ne čita. Ništa se ne briše.

UPDATE public.tj_tracker_rules
   SET deleted_at = now()
 WHERE auto_key = 'no_entry_in_red_window'
   AND deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.tj_seed_tracker_rules(target uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if exists (select 1 from public.tj_tracker_rules where user_id = target) then
    return;
  end if;

  insert into public.tj_tracker_rules (user_id, text, stage, auto_key, config, is_mandatory, sort_order)
  select target, v.text, v.stage, v.auto_key, v.config::jsonb, v.mandatory, v.ord
  from (values
    -- Priprema: pre otvaranja.
    ('Provera kalendara i HTF-a: Proveravam crvene vesti i markiram HTF nivoe likvidnosti pre gledanja manjih tajmfrejmova.', 'prepare', null, '{}', true,  0),
    ('Mentalni check-in: Platformu palim samo ako sam odmoran, smiren i nemam nikakvih distrakcija oko sebe.',             'prepare', null, '{}', false, 1),
    -- Trgovanje: ručna.
    ('Vreme trgovanja: Pozicije otvaram isključivo unutar mojih definisanih vremenskih okvira.',                            'trade',   null, '{}', false, 2),
    ('Kontrola rizika: Rizik po trejdu je strogo kontrolisan i Stop Loss se postavlja momentalno.',                          'trade',   null, '{}', false, 3),
    -- Trgovanje: automatska, iz podataka.
    ('Svaki trejd vezan za playbook',                 'trade', 'playbook_linked',        '{}',             true,  4),
    ('Svaki trejd ima unet stop loss',                'trade', 'stop_loss_set',          '{}',             true,  5),
    ('Svaki trejd ima tezu napisanu pre ulaza',       'trade', 'thesis_written',         '{}',             true,  6),
    ('Ravno do kraja dana',                           'trade', 'flat_by_close',          '{}',             true,  7),
    ('Dva SL zaredom = kraj dana (dobitak ili scratch između prekida niz)', 'trade', 'stop_after_two_losses', '{}', true, 8),
    -- Osvrt: posle sesije.
    ('Dnevnik i tagovi: Unosim svaki trejd u aplikaciju i popunjavam sve tagove (smer, greške, emocije, razlog izlaska).', 'reflect', null, '{}', false, 9),
    ('Screenshotovi: Čuvam sliku čarta za svaki uzet trejd (sa vidljivim ulazom, izlazom i strukturom).',                 'reflect', null, '{}', false, 10)
  ) as v(text, stage, auto_key, config, mandatory, ord);
end;
$function$;
