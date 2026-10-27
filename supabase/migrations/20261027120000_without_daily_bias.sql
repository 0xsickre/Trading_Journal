-- Faza E (27.10.2026): journal bez biasa dana.
--
-- ZAŠTO. Trejder: „Ne koristim više bias dana — market ne može da se predvidi, nego se trguje uz njega, uz
-- reakciju.“ Predviđanje smera izlazi iz celog toka journala, kao pravila prop firme u fazi X. Kod više ne čita
-- karticu ni polje „Bias dana“ i ne ocenjuje ih.
--
-- ŠTA.
--   * `htf_bias_set` se PENZIONIŠE (`deleted_at`), kao `no_entry_in_red_window` u `20261026190000`: zaključani
--     dani čuvaju zamrznute ocene, pa red i ključ u CHECK-u ostaju.
--   * „Dnevnik i tagovi“ (`review_complete`) više ne traži bias dana — nov tekst pravila.
--   * Polje trejda „Bias dana“ (`tj_field_defs.htf_bias`) se gasi (`is_active = false`). Vrednost na starim
--     trejdovima (`custom.htf_bias`) ostaje i vidi se samo za čitanje.
--   * Fabričke kategorije (`tj_seed_categories`, nov ili resetovan nalog) bez liste i polja „Bias dana“ i bez
--     greške „Bez biasa dana pre ulaza“. Ta opcija je u postojećoj knjizi već isključena (B2).
--   * Tabela `tj_daily_bias` i njeni redovi ostaju kao istorija; journal ih više ne čita. Ništa se ne briše.
--   Fabrička lista pravila (`tj_seed_tracker_rules`, `20261027100000`) već nema `htf_bias_set` i ne menja se.

UPDATE public.tj_tracker_rules
   SET deleted_at = now()
 WHERE auto_key = 'htf_bias_set'
   AND deleted_at IS NULL;

UPDATE public.tj_tracker_rules
   SET text = 'Dnevnik i tagovi: svaki trejd ima ocenu, razlog izlaza i grešku ili ocenu A; uz ocenu C i jednu rečenicu.'
 WHERE auto_key = 'review_complete'
   AND deleted_at IS NULL;

UPDATE public.tj_field_defs
   SET is_active = false
 WHERE key = 'htf_bias'
   AND is_active;

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
      ('entry_tf','TF ulaza','Context',1),
      ('technical_tag','Tehnički tagovi','ICT Setup',2),
      ('setup_grade','Ocena setupa','ICT Setup',3),
      ('exit_reason','Razlog izlaza','Risk',4),
      ('miss_reason','Razlog propuštanja','Risk',5),
      ('emotion','Emocije','Psychology',6),
      ('discipline','Disciplina','Psychology',7),
      ('mistake','Greške','Psychology',8)
    ) as v(key, label, category, sort_order);

    insert into public.tj_option_items (user_id, list_id, value, label, sort_order)
    select target, l.id, v.value, v.value, v.ord
    from (values
      ('direction','Long',0),('direction','Short',1),
      ('entry_tf','30s',0),('entry_tf','1m',1),('entry_tf','2m',2),('entry_tf','5m',3),('entry_tf','15m',4),('entry_tf','1h',5),
      ('technical_tag','Sweep likvidnosti',0),('technical_tag','MSS',1),('technical_tag','BOS',2),('technical_tag','FVG',3),('technical_tag','iFVG',4),('technical_tag','Order blok',5),('technical_tag','Breaker blok',6),('technical_tag','OTE',7),('technical_tag','SMT divergencija',8),('technical_tag','HTF odbijanje (1h/4h zatvaranje)',9),('technical_tag','Momentum sveće',10),('technical_tag','Ponoćni pojas',11),('technical_tag','Cilj: FVG',12),('technical_tag','Cilj: likvidnost',13),
      ('setup_grade','A+',0),('setup_grade','A',1),('setup_grade','B',2),('setup_grade','C',3),
      ('exit_reason','Pogođen target',0),('exit_reason','Pogođen stop',1),('exit_reason','Na nuli',2),('exit_reason','Prateći stop',3),('exit_reason','Zatvoreno ranije',4),('exit_reason','Ručni izlaz: invalidacija',5),('exit_reason','Ručni izlaz: pre vesti',6),('exit_reason','Izlaz po vremenu (kraj prozora)',7),('exit_reason','Kraj dana (ravno)',8),
      ('miss_reason','Limit nije popunjen',0),('miss_reason','Oklevao',1),('miss_reason','Nisam bio za ekranom',2),('miss_reason','Preskočen po pravilima',3),('miss_reason','Vesti / događaj',4),('miss_reason','Video tek na snimku',5),
      ('emotion','Smiren',0),('emotion','FOMO',1),('emotion','Strah',2),('emotion','Osveta',3),('emotion','Nestrpljiv',4),('emotion','Previše samouveren',5),('emotion','Umoran',6),('emotion','Ometen',7),('emotion','Pohlepan',8),
      ('discipline','Ispoštovao rizik',0),('discipline','Vodio po planu',1),
      ('mistake','Bez greške',0),('mistake','Ulaz bez setupa iz playbook-a',1),('mistake','Teza posle klika',2),('mistake','Rani ulaz',3),('mistake','Jurio cenu',4),('mistake','Ulaz van prozora',5),('mistake','Ulaz u crvenom prozoru',6),('mistake','Ulaz posle 2 SL',7),('mistake','Osvetnički ponovni ulaz',8),('mistake','Prevelika pozicija',9),('mistake','Stop postavio bracket, ne ja',10),('mistake','Pomerio stop',11),('mistake','Dodao protiv pozicije',12),('mistake','Cilj ispod 2R',13),('mistake','Rano zatvorio dobitak',14),('mistake','Dobitak pretvorio u gubitak',15),('mistake','Previše trejdova',16)
    ) as v(list_key, value, ord)
    join public.tj_option_lists l on l.user_id = target and l.key = v.list_key;

    insert into public.tj_field_defs (user_id, key, label, field_type, list_key, show_phase, sort_order)
    select target, v.key, v.label, v.field_type, v.list_key, v.show_phase, v.ord
    from (values
      ('entry_tf',        'TF ulaza',           'select', 'entry_tf',      'always', 0),
      ('technical_tags',  'Tehnički tagovi',    'tags',   'technical_tag', 'always', 1),
      ('exit_reason',     'Razlog izlaza',      'select', 'exit_reason',   'active', 2),
      ('mistake',         'Greške',             'tags',   'mistake',       'active', 3),
      ('psychology_tags', 'Psihologija',        'tags',   'emotion',       'active', 4),
      ('miss_reason',     'Razlog propuštanja', 'select', 'miss_reason',   'missed', 5)
    ) as v(key, label, field_type, list_key, show_phase, ord)
    on conflict (user_id, key) do nothing;
  end if;
end;
$function$;
