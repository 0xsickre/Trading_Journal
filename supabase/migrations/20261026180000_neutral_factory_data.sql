-- Faza X5 (26.10.2026): fabrički podaci bez prop firme (X-8 A).
--
-- ZAŠTO. Journal ne zna ni za jednu prop firmu. Fabričke provizije su bile Topstep-ove (help.topstep.com), razlog
-- izlaza „Kraj Topstep dana“ i greške „Ulaz posle dnevnog cilja“ / „Ulaz posle DLL-a“ čitaju pravila firme.
--
-- ŠTA.
--   * `tj_seed_instruments_defaults`: osam fjučersa sa provizijom 0. Trejder je upisuje po instrumentu (Settings ›
--     Instruments), kasnije je donosi fill. Radi samo za prazan nalog, pa postojeći instrumenti i trejdovi ostaju
--     kakvi su — knjiga se ne menja.
--   * `tj_seed_categories` (novi ili resetovan nalog): „Kraj dana (ravno)“ umesto „Kraj Topstep dana“, bez dve
--     greške koje traže novčani limit firme (B-1 A).
--   * Postojeća opcija „Kraj Topstep dana“ dobija novo ime. Nijedan trejd je nema (provereno 26.10.2026), pa se
--     ništa istorijsko ne menja. Opcija „Ulaz posle DLL-a“ ostaje isključena (B2).

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
      ('exit_reason','Pogođen target',0),('exit_reason','Pogođen stop',1),('exit_reason','Na nuli',2),('exit_reason','Prateći stop',3),('exit_reason','Zatvoreno ranije',4),('exit_reason','Ručni izlaz: invalidacija',5),('exit_reason','Ručni izlaz: pre vesti',6),('exit_reason','Izlaz po vremenu (kraj prozora)',7),('exit_reason','Kraj dana (ravno)',8),
      ('miss_reason','Limit nije popunjen',0),('miss_reason','Oklevao',1),('miss_reason','Nisam bio za ekranom',2),('miss_reason','Preskočen po pravilima',3),('miss_reason','Vesti / događaj',4),('miss_reason','Video tek na snimku',5),
      ('emotion','Smiren',0),('emotion','FOMO',1),('emotion','Strah',2),('emotion','Osveta',3),('emotion','Nestrpljiv',4),('emotion','Previše samouveren',5),('emotion','Umoran',6),('emotion','Ometen',7),('emotion','Pohlepan',8),
      ('discipline','Ispoštovao rizik',0),('discipline','Vodio po planu',1),
      ('mistake','Bez greške',0),('mistake','Bez biasa dana pre ulaza',1),('mistake','Ulaz bez setupa iz playbook-a',2),('mistake','Teza posle klika',3),('mistake','Rani ulaz',4),('mistake','Jurio cenu',5),('mistake','Ulaz van prozora',6),('mistake','Ulaz u crvenom prozoru',7),('mistake','Ulaz posle 2 SL',8),('mistake','Osvetnički ponovni ulaz',9),('mistake','Prevelika pozicija',10),('mistake','Stop postavio bracket, ne ja',11),('mistake','Pomerio stop',12),('mistake','Dodao protiv pozicije',13),('mistake','Cilj ispod 2R',14),('mistake','Rano zatvorio dobitak',15),('mistake','Dobitak pretvorio u gubitak',16),('mistake','Previše trejdova',17)
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

create or replace function public.tj_seed_instruments_defaults(target uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  -- Only ever for an empty book. Re-running this must not resurrect a symbol
  -- the trader deleted, which is what `20260920001500` was written to stop.
  if exists (select 1 from public.tj_instruments where user_id = target) then
    return;
  end if;

  insert into public.tj_instruments (
    user_id, symbol, name, asset_class,
    point_value, tick_size, tick_value, quote_currency,
    commission_per_lot, commission_pct, commission_currency,
    is_active, sort_order
  )
  select target, v.symbol, v.name, 'Futures',
         v.point_value, v.tick_size, null::numeric, 'USD',
         v.commission_per_lot, 0, 'USD',
         true, v.ord
  from (values
    ('NQ','E-mini Nasdaq 100',20::numeric,0.25::numeric,0::numeric,30),
    ('MNQ','Micro E-mini Nasdaq 100',2,0.25,0,31),
    ('ES','E-mini S&P 500',50,0.25,0,32),
    ('MES','Micro E-mini S&P 500',5,0.25,0,33),
    ('6E','Euro FX',125000,0.00005,0,34),
    ('M6E','Micro EUR/USD',12500,0.0001,0,35),
    ('GC','Gold',100,0.1,0,36),
    ('MGC','Micro Gold',10,0.1,0,37)
  ) as v(symbol, name, point_value, tick_size, commission_per_lot, ord);
end;
$function$;


UPDATE public.tj_option_items i
   SET value = 'Kraj dana (ravno)', label = 'Kraj dana (ravno)'
  FROM public.tj_option_lists l
 WHERE l.id = i.list_id
   AND l.key = 'exit_reason'
   AND i.value = 'Kraj Topstep dana'
   AND NOT EXISTS (SELECT 1 FROM public.tj_positions p WHERE p.user_id = l.user_id AND p.exit_reason = 'Kraj Topstep dana')
   AND NOT EXISTS (SELECT 1 FROM public.tj_option_items x WHERE x.list_id = l.id AND x.value = 'Kraj dana (ravno)');
