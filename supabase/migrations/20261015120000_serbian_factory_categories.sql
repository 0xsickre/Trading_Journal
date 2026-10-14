-- J2: the factory categories are the trader's own book of 15.10.2026 (phase J).
--
-- On 15.10.2026 the mentor (trading-mentor) rewrote the trader's lists in the database at his
-- request: duplicates merged, typos fixed, the mistakes he actually makes added, the names of the
-- lists and fields in Serbian. `tj_seed_categories` still held the list of 30.09
-- (20260930030000), so "Delete all data" would have brought the old tags back. This restates it
-- with the lists, items and fields read from `tj_option_lists`, `tj_option_items` and
-- `tj_field_defs` that day (SELECT only, in the trader's order).
--
-- NO DATA CHANGES. The function still does nothing for a user who already has lists, so the
-- trader's book, his trades and their tags are untouched; only a new or reset book is affected.
--
-- Values the code reads by name are all here: Bez greške, Ispoštovao rizik, Vodio po planu,
-- Pogođen stop, Pogođen target, Na nuli, Prateći stop, Zatvoreno ranije, and the bias that starts
-- with "Nisam odredio". The list categories (Context, ICT Setup, Risk, Psychology) are as they are
-- in the database. `seed-categories.test.ts` reads this function and checks all of it.

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
      ('direction','Smer','Context',0),
      ('htf_bias','Bias dana','Context',1),
      ('entry_tf','TF ulaza','Context',2),
      ('technical_tag','Tehnički tagovi','ICT Setup',3),
      ('setup_grade','Ocena setupa','ICT Setup',4),
      ('exit_reason','Razlog izlaza','Risk',5),
      ('miss_reason','Razlog propuštanja','Risk',6),
      ('emotion','Emocije','Psychology',7),
      ('discipline','Disciplina','Psychology',8),
      ('mistake','Greške','Psychology',9)
    ) as v(key, label, category, sort_order);

    insert into public.tj_option_items (user_id, list_id, value, label, sort_order)
    select target, l.id, v.value, v.value, v.ord
    from (values
      ('direction','Long',0),('direction','Short',1),
      ('htf_bias','Gore (bullish)',0),('htf_bias','Dole (bearish)',1),('htf_bias','Nema biasa',2),('htf_bias','Nisam odredio unapred',3),
      ('entry_tf','30s',0),('entry_tf','1m',1),('entry_tf','2m',2),('entry_tf','5m',3),('entry_tf','15m',4),('entry_tf','1h',5),
      ('technical_tag','Sweep likvidnosti',0),('technical_tag','MSS',1),('technical_tag','BOS',2),('technical_tag','FVG',3),('technical_tag','iFVG',4),('technical_tag','Order blok',5),('technical_tag','Breaker blok',6),('technical_tag','OTE',7),('technical_tag','SMT divergencija',8),('technical_tag','HTF odbijanje (1h/4h zatvaranje)',9),('technical_tag','Momentum sveće',10),('technical_tag','Ponoćni pojas',11),('technical_tag','Cilj: FVG',12),('technical_tag','Cilj: likvidnost',13),
      ('setup_grade','A+',0),('setup_grade','A',1),('setup_grade','B',2),('setup_grade','C',3),
      ('exit_reason','Pogođen target',0),('exit_reason','Pogođen stop',1),('exit_reason','Na nuli',2),('exit_reason','Prateći stop',3),('exit_reason','Zatvoreno ranije',4),('exit_reason','Ručni izlaz: invalidacija',5),('exit_reason','Ručni izlaz: pre vesti',6),('exit_reason','Izlaz po vremenu (kraj prozora)',7),('exit_reason','Kraj Topstep dana',8),
      ('miss_reason','Limit nije popunjen',0),('miss_reason','Oklevao',1),('miss_reason','Nisam bio za ekranom',2),('miss_reason','Preskočen po pravilima',3),('miss_reason','Vesti / događaj',4),('miss_reason','Video tek na snimku',5),
      ('emotion','Smiren',0),('emotion','FOMO',1),('emotion','Strah',2),('emotion','Osveta',3),('emotion','Nestrpljiv',4),('emotion','Previše samouveren',5),('emotion','Umoran',6),('emotion','Ometen',7),('emotion','Pohlepan',8),
      ('discipline','Ispoštovao rizik',0),('discipline','Vodio po planu',1),
      ('mistake','Bez greške',0),('mistake','Bez biasa dana pre ulaza',1),('mistake','Ulaz bez setupa iz playbook-a',2),('mistake','Teza posle klika',3),('mistake','Rani ulaz',4),('mistake','Jurio cenu',5),('mistake','Ulaz van prozora',6),('mistake','Ulaz u crvenom prozoru',7),('mistake','Ulaz posle 2 SL',8),('mistake','Ulaz posle dnevnog cilja',9),('mistake','Ulaz posle DLL-a',10),('mistake','Osvetnički ponovni ulaz',11),('mistake','Prevelika pozicija',12),('mistake','Stop postavio bracket, ne ja',13),('mistake','Pomerio stop',14),('mistake','Dodao protiv pozicije',15),('mistake','Cilj ispod 2R',16),('mistake','Rano zatvorio dobitak',17),('mistake','Dobitak pretvorio u gubitak',18),('mistake','Previše trejdova',19)
    ) as v(list_key, value, ord)
    join public.tj_option_lists l on l.user_id = target and l.key = v.list_key;

    insert into public.tj_field_defs (user_id, key, label, field_type, list_key, show_phase, sort_order)
    select target, v.key, v.label, v.field_type, v.list_key, v.show_phase, v.ord
    from (values
      ('htf_bias',        'Bias dana',          'select', 'htf_bias',      'always', 0),
      ('entry_tf',        'TF ulaza',           'select', 'entry_tf',      'always', 1),
      ('technical_tags',  'Tehnički tagovi',    'tags',   'technical_tag', 'always', 2),
      ('exit_reason',     'Razlog izlaza',      'select', 'exit_reason',   'active', 3),
      ('mistake',         'Greške',             'tags',   'mistake',       'active', 4),
      ('psychology_tags', 'Psihologija',        'tags',   'emotion',       'active', 5),
      ('miss_reason',     'Razlog propuštanja', 'select', 'miss_reason',   'missed', 6)
    ) as v(key, label, field_type, list_key, show_phase, ord)
    on conflict (user_id, key) do nothing;
  end if;
end;
$function$;
