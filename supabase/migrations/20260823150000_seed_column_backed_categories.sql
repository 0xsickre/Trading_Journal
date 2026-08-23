-- Nov nalog dobija istih devet kategorija, ne četiri.
--
-- `20260823140000` je pet kategorija koje su živele u `form-config.ts`
-- (`technical_tags`, `exit_reason`, `mistake`, `psychology_tags`,
-- `miss_reason`) pretvorio u redove `tj_field_defs`. To je popravilo postojeće
-- naloge, ali `tj_seed_defaults` je i dalje sejao samo četiri polja — pa bi nov
-- nalog dobio formu bez tih pet kategorija, a Settings bi ih prikazao kao liste
-- koje nijedno polje ne čita. Zato ovde, u istoj funkciji koja pravi i liste iz
-- kojih te kategorije čitaju.
--
-- Faze i tipovi su prepisani iz `20260823140000`, da nov nalog izgleda kao
-- postojeći posle migracije. Ako se tamo nešto promeni, menja se i ovde — dva
-- spiska su cena toga što jedan popravlja zatečeno stanje a drugi pravi novo.
--
-- Ostatak funkcije je nepromenjen; CREATE OR REPLACE traži celo telo.

CREATE OR REPLACE FUNCTION public.tj_seed_defaults(target uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not exists (select 1 from public.tj_accounts where user_id = target) then
    insert into public.tj_accounts (user_id, name, currency, starting_balance, default_asset_class, timezone)
    values (target, 'Main Account', 'USD', 0, 'Futures', 'America/New_York');
  end if;

  if not exists (select 1 from public.tj_option_lists where user_id = target) then
    insert into public.tj_option_lists (user_id, key, label, category, sort_order)
    select target, v.key, v.label, v.category, v.sort_order
    from (values
      ('direction','Direction','Context',0),
      ('macro_align','Macro Align','Context',1),
      ('cot_filter','COT Filter','Context',2),
      ('htf_bias','HTF Bias','Context',3),
      ('entry_tf','Entry TF','Context',4),
      ('technical_tag','Technical Tags','ICT Setup',5),
      ('setup_grade','Setup Grade','ICT Setup',6),
      ('risk_pct','Risk %','Risk',7),
      ('exit_reason','Exit Reason','Risk',9),
      ('miss_reason','Miss Reason','Risk',10),
      ('emotion','Emotion','Psychology',11),
      ('discipline','Discipline','Psychology',12),
      ('mistake','Mistake','Psychology',13)
    ) as v(key, label, category, sort_order);

    insert into public.tj_option_items (user_id, list_id, value, label, sort_order)
    select target, l.id, v.value, v.value, v.ord
    from (values
      ('direction','Long',0),('direction','Short',1),
      ('macro_align','Aligned',0),('macro_align','Neutral',1),('macro_align','Against',2),
      ('cot_filter','Bullish',0),('cot_filter','Neutral',1),('cot_filter','Bearish',2),
      ('htf_bias','Bullish',0),('htf_bias','Neutral',1),('htf_bias','Bearish',2),
      ('entry_tf','1m',0),('entry_tf','5m',1),('entry_tf','15m',2),('entry_tf','1h',3),('entry_tf','4h',4),('entry_tf','1D',5),
      ('technical_tag','FVG',0),('technical_tag','Order Block',1),('technical_tag','Liquidity Sweep',2),('technical_tag','Breaker',3),('technical_tag','BOS',4),('technical_tag','CHoCH',5),('technical_tag','Imbalance',6),('technical_tag','Equal Highs/Lows',7),
      ('setup_grade','A+',0),('setup_grade','A',1),('setup_grade','B',2),('setup_grade','C',3),
      ('risk_pct','0.25',0),('risk_pct','0.5',1),('risk_pct','1',2),('risk_pct','2',3),
      ('exit_reason','Target hit',0),('exit_reason','Stop hit',1),('exit_reason','Manual',2),('exit_reason','Time stop',3),('exit_reason','Trail',4),
      ('miss_reason','No fill',0),('miss_reason','Price ran away',1),('miss_reason','Setup invalidated',2),('miss_reason','News / event',3),('miss_reason','Discretion',4),('miss_reason','Session ended',5),('miss_reason','Other',6),
      ('emotion','Discipliniran',0),('emotion','FOMO',1),('emotion','Strah',2),('emotion','Pohlepa',3),('emotion','Revenge',4),('emotion','Nestrpljiv',5),('emotion','Overconfident',6),('emotion','Umoran/rastrojen',7),
      ('discipline','Followed plan',0),('discipline','Moved stop',1),('discipline','Cut winner short',2),('discipline','Revenge',3),('discipline','Oversized',4),
      ('mistake','None',0),('mistake','Late entry',1),('mistake','Early/no confirmation',2),('mistake','Moved stop',3),('mistake','Cut winner short',4),('mistake','Oversized',5),('mistake','Chased/FOMO',6),('mistake','Against bias',7)
    ) as v(list_key, value, ord)
    join public.tj_option_lists l on l.user_id = target and l.key = v.list_key;
  end if;

  if not exists (select 1 from public.tj_field_defs where user_id = target) then
    -- `list_key` je ovde poseban stubac a ne `v.key`: pet novih polja se ne zovu
    -- kao lista iz koje čitaju (`technical_tags` čita `technical_tag`,
    -- `psychology_tags` čita `emotion`), jer ime polja je ime KOLONE na
    -- `tj_positions` koju izveštaji, grid i CSV izvoz čitaju.
    insert into public.tj_field_defs (user_id, key, label, field_type, list_key, show_phase, sort_order)
    select target, v.key, v.label, v.field_type, v.list_key, v.show_phase, v.ord
    from (values
      ('entry_tf',        'Entry TF',        'select', 'entry_tf',      'always', 0),
      ('macro_align',     'Macro Align',     'select', 'macro_align',   'always', 1),
      ('cot_filter',      'COT Filter',      'select', 'cot_filter',    'always', 2),
      ('htf_bias',        'HTF Bias',        'select', 'htf_bias',      'always', 3),
      ('technical_tags',  'Technical Tags',  'tags',   'technical_tag', 'always', 4),
      ('exit_reason',     'Exit Reason',     'select', 'exit_reason',   'active', 5),
      ('mistake',         'Mistake',         'tags',   'mistake',       'active', 6),
      ('psychology_tags', 'Psychology tags', 'tags',   'emotion',       'active', 7),
      ('miss_reason',     'Miss Reason',     'select', 'miss_reason',   'missed', 8)
    ) as v(key, label, field_type, list_key, show_phase, ord)
    on conflict (user_id, key) do nothing;
  end if;

  perform public.tj_seed_instruments_defaults(target);
  perform public.tj_seed_playbooks(target);
  perform public.tj_seed_tracker_rules(target);
  perform public.tj_seed_note_folders(target);
end;
$function$;
