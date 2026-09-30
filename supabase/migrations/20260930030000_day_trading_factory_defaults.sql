-- Fabrička podešavanja za day tradera (30.09.2026).
--
-- Šta nalog dobija pri registraciji i posle „Delete all data“ (tj_reset_my_data →
-- tj_seed_my_defaults → tj_seed_defaults). Postojeći podaci se NE menjaju: svaka
-- funkcija i dalje ne radi ništa ako korisnik već ima redove u toj tabeli.
--
-- Odluke trejdera:
--   * nalog ostaje „Main Account“ bez Topstep režima (plan i balans se biraju u Settings);
--   * Entry TF: 30s, 1m, 2m, 5m, 15m, 1h;
--   * ručna pravila trackera = trejderova sopstvena (priprema, trgovanje, osvrt);
--     automatskih jedanaest ostaje kako jeste;
--   * folderi beleški: Plan sesije, Osvrt na sesiju, Trade Notes (sistemski), Nedeljni osvrt.

CREATE OR REPLACE FUNCTION public.tj_seed_categories(target uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not exists (select 1 from public.tj_option_lists where user_id = target) then
    insert into public.tj_option_lists (user_id, key, label, category, sort_order)
    select target, v.key, v.label, v.category, v.sort_order
    from (values
      ('direction','Direction','Context',0),
      ('htf_bias','Bias dana (brief)','Context',1),
      ('entry_tf','Entry TF','Context',2),
      ('technical_tag','Technical Tags','ICT Setup',3),
      ('setup_grade','Setup Grade','ICT Setup',4),
      ('exit_reason','Exit Reason','Risk',5),
      ('miss_reason','Miss Reason','Risk',6),
      ('emotion','Emotion','Psychology',7),
      ('discipline','Discipline','Psychology',8),
      ('mistake','Mistake','Psychology',9)
    ) as v(key, label, category, sort_order);

    insert into public.tj_option_items (user_id, list_id, value, label, sort_order)
    select target, l.id, v.value, v.value, v.ord
    from (values
      ('direction','Long',0),('direction','Short',1),
      ('htf_bias','Long',0),('htf_bias','Short',1),('htf_bias','Neutralno',2),
      ('entry_tf','30s',0),('entry_tf','1m',1),('entry_tf','2m',2),('entry_tf','5m',3),('entry_tf','15m',4),('entry_tf','1h',5),
      ('technical_tag','Sweep likvidnosti',0),('technical_tag','MSS',1),('technical_tag','FVG',2),('technical_tag','iFVG',3),('technical_tag','Order blok',4),('technical_tag','Breaker blok',5),('technical_tag','OTE',6),('technical_tag','SMT divergencija',7),('technical_tag','HTF odbijanje na zatvaranju',8),
      ('setup_grade','A+',0),('setup_grade','A',1),('setup_grade','B',2),('setup_grade','C',3),
      ('exit_reason','Pogođen target',0),('exit_reason','Pogođen stop',1),('exit_reason','Na nuli',2),('exit_reason','Prateći stop',3),('exit_reason','Zatvoreno ranije',4),('exit_reason','Izlaz po vremenu',5),('exit_reason','Zatvoreno do kraja dana',6),
      ('miss_reason','Nije popunjen',0),('miss_reason','Oklevao',1),('miss_reason','Nisam bio za ekranom',2),('miss_reason','Preskočen po pravilima',3),('miss_reason','Vesti / događaj',4),
      ('emotion','Smiren',0),('emotion','FOMO',1),('emotion','Strah',2),('emotion','Osveta',3),('emotion','Nestrpljiv',4),('emotion','Previše samouveren',5),('emotion','Umoran',6),
      ('discipline','Ispoštovao plan',0),('discipline','Ispoštovao rizik',1),('discipline','Vodio po planu',2),
      ('mistake','Bez greške',0),('mistake','Rani ulaz',1),('mistake','Jurio cenu',2),('mistake','Pomerio stop',3),('mistake','Rano zatvorio dobitak',4),('mistake','Prevelika pozicija',5),('mistake','Previše trejdova',6),('mistake','Trejd posle DLL plana',7),('mistake','Osvetnički ponovni ulaz',8),('mistake','Trejd u crvenom prozoru',9)
    ) as v(list_key, value, ord)
    join public.tj_option_lists l on l.user_id = target and l.key = v.list_key;

    insert into public.tj_field_defs (user_id, key, label, field_type, list_key, show_phase, sort_order)
    select target, v.key, v.label, v.field_type, v.list_key, v.show_phase, v.ord
    from (values
      ('htf_bias',        'Bias dana (brief)', 'select', 'htf_bias',    'always', 0),
      ('entry_tf',        'Entry TF',        'select', 'entry_tf',      'always', 1),
      ('technical_tags',  'Technical Tags',  'tags',   'technical_tag', 'always', 2),
      ('exit_reason',     'Exit Reason',     'select', 'exit_reason',   'active', 3),
      ('mistake',         'Mistake',         'tags',   'mistake',       'active', 4),
      ('psychology_tags', 'Psychology tags', 'tags',   'emotion',       'active', 5),
      ('miss_reason',     'Miss Reason',     'select', 'miss_reason',   'missed', 6)
    ) as v(key, label, field_type, list_key, show_phase, ord)
    on conflict (user_id, key) do nothing;
  end if;
end;
$function$;

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
    ('Walk Away Target: Ako ostvarim svoj dnevni cilj u dolarima, zatvaram čartove i ne vraćam profit marketu.',              'trade',   null, '{}', false, 4),
    -- Trgovanje: automatska, iz podataka.
    ('Svaki trejd vezan za playbook',                 'trade', 'playbook_linked',        '{}',             true,  5),
    ('Svaki trejd ima unet stop loss',                'trade', 'stop_loss_set',          '{}',             true,  6),
    ('Svaki trejd ima tezu napisanu pre ulaza',       'trade', 'thesis_written',         '{}',             true,  7),
    ('Net max gubitak po trejdu',                     'trade', 'max_loss_per_trade',     '{}',             true,  8),
    ('Net max gubitak po danu',                       'trade', 'max_loss_per_day',       '{}',             true,  9),
    ('Rizik na ulazu u okviru budžeta',               'trade', 'risk_per_trade',         '{}',             true, 10),
    ('Broj ugovora po budžetu rizika',                'trade', 'risk_matched_intent',    '{}',             true, 11),
    ('Dnevni limit ulaza po nalogu',                  'trade', 'max_trades_per_day',     '{"count": 2}',   true, 12),
    ('Stop posle uzastopnih gubitaka',                'trade', 'stop_after_losses',      '{"count": 2}',   true, 13),
    ('Ravno do kraja Topstep dana',                   'trade', 'flat_by_close',          '{}',             true, 14),
    ('Bez ulaza u crvenom prozoru vesti (brief)',     'trade', 'no_entry_in_red_window', '{}',             true, 15),
    -- Osvrt: posle sesije.
    ('Dnevnik i tagovi: Unosim svaki trejd u aplikaciju i popunjavam sve tagove (smer, greške, emocije, razlog izlaska).', 'reflect', null, '{}', false, 16),
    ('Screenshotovi: Čuvam sliku čarta za svaki uzet trejd (sa vidljivim ulazom, izlazom i strukturom).',                 'reflect', null, '{}', false, 17)
  ) as v(text, stage, auto_key, config, mandatory, ord);
end;
$function$;

CREATE OR REPLACE FUNCTION public.tj_seed_note_folders(target uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if exists (select 1 from public.tj_note_folders where user_id = target) then
    return;
  end if;

  insert into public.tj_note_folders (user_id, name, sort_order, template_text, is_system)
  values
    (target, 'Plan sesije', 0,
E'## Plan sesije\n\n### Brief i vesti\n- Crveni prozori:\n- Bias dana:\n\n### Nivoi (HTF likvidnost)\n- Iznad:\n- Ispod:\n\n### Scenariji\n- Long ako:\n- Short ako:\n\n### Rizik\n- Budžet po trejdu:\n- DLL ostatak:\n- Max trejdova danas:\n', false),
    (target, 'Osvrt na sesiju', 1,
E'## Osvrt na sesiju\n\n### Brojevi\n- Neto P&L:\n- Trejdova:\n- Pravila ispoštovana:\n\n### Šta je radilo\n\n### Šta nije radilo\n\n### Da li sam stao na vreme (DLL, 2 gubitka, dnevni cilj)\n\n### Jedna stvar za sutra\n', false),
    (target, 'Trade Notes', 2,
E'## Trejd\n\n### Zašto sam ušao\n\n### Šta je tržište uradilo\n\n### Šta bih uradio drugačije\n', true),
    (target, 'Nedeljni osvrt', 3,
E'## Nedelja\n\n### Brojevi\n- Neto P&L:\n- Trejdova / trading dana:\n- Doslednost procesa:\n- Najbolji i najgori sesijski prozor:\n\n### Šta je radilo\n\n### Šta nije radilo\n\n### Jedan obrazac koji vidim\n\n### Jedna stvar koju menjam sledeće nedelje\n', false);
end;
$function$;
