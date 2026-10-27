-- Faza B5, dopuna (27.10.2026, nalaz pregleda koda): fabrička lista pravila dobija „Psihologija dana“.
--
-- ZAŠTO. `20261026170000` je pravilo `daily_psychology` dodalo samo postojećim korisnicima, a `20261026190000` je
-- fabričku listu prepisao bez njega — nov ili resetovan nalog ga nikad ne bi dobio, iako je obavezno.
--
-- ŠTA. Nova definicija `tj_seed_tracker_rules` sa tim pravilom (osvrt, obavezno). Postojeći podaci se ne menjaju.
-- Traži CHECK sa ključem `daily_psychology` (primenjen 26.10.2026).

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
    ('Screenshotovi: Čuvam sliku čarta za svaki uzet trejd (sa vidljivim ulazom, izlazom i strukturom).',                 'reflect', null, '{}', false, 10),
    ('Psihologija dana: na /daily upisano kako sam se osećao (dan sa trejdom).',                                           'reflect', 'daily_psychology', '{}', true, 11)
  ) as v(text, stage, auto_key, config, mandatory, ord);
end;
$function$;
