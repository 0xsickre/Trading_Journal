-- Preraspoređivanje korisničkih polja po grupama forme.
--
-- Dve izmene, obe zato što je polje stajalo u grupi koja ne opisuje šta ono
-- jeste:
--
--   entry_tf : plan_advanced -> setup
--     Entry TF je obavezan deo unosa, a stajao je iza „Advanced" trougla —
--     jedinog mesta u formi koje govori „ovo možeš da preskočiš". Timeframe na
--     kom si izvršio je svojstvo SETAPA, uz grade i tehničke tagove.
--
--   htf_bias : setup -> macro
--     README, doslovno: „polja macro_align, cot_filter i htf_bias vezuju svaki
--     trejd nazad na nedeljni makro kontekst iz vault sistema." Njih troje su
--     jedna misao — smer i kvalitet backdrop-a — a htf_bias je jedini bio
--     odvojen. Grupa `macro` se u formi zove „Kontekst".
--
-- Posle ovoga obe „Advanced" grupe ostaju PRAZNE i forma ih ne renderuje. To je
-- namerno i to je ceo odgovor na pitanje šta zaslužuje da bude sakriveno: ništa
-- što je sad u formi. Sve preostalo je ili ulaz u računicu (cene, rizik, target)
-- ili polje zbog kog se dnevnik vodi (greška, tagovi, beleška). `plan_advanced` i
-- `execution_advanced` ostaju legalne grupe u FIELD_DEF_GROUPS i u Settings
-- padajućem meniju — prazna grupa je mesto koje čeka, ne greška.
--
-- Grupe se ovde menjaju PODACIMA, ne šemom: `group_id` je kolona sa CHECK-om nad
-- fiksnim skupom, a raspored polja je korisnička konfiguracija koju i sam možeš
-- promeniti u Settings › Moja polja.

UPDATE public.tj_field_defs
   SET group_id = 'setup', sort_order = 0
 WHERE key = 'entry_tf';

UPDATE public.tj_field_defs
   SET group_id = 'macro', sort_order = 2
 WHERE key = 'htf_bias';

-- Isti raspored za sledećeg korisnika. Bez ovoga bi živa baza i seed rekli
-- različito, pa bi novi nalog dobio stari raspored — a razlika bi se videla tek
-- kad neko otvori formu.
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
      ('result','Result','Risk',8),
      ('exit_reason','Exit Reason','Risk',9),
      ('miss_reason','Miss Reason','Risk',10),
      ('emotion','Emotion','Psychology',11),
      ('discipline','Discipline','Psychology',12),
      ('mistake','Mistake','Psychology',13)
    ) as v(key, label, category, sort_order);

    insert into public.tj_option_items (user_id, list_id, value, sort_order)
    select target, l.id, v.value, v.ord
    from (values
      ('direction','Long',0),('direction','Short',1),
      ('macro_align','Aligned',0),('macro_align','Neutral',1),('macro_align','Against',2),
      ('cot_filter','Bullish',0),('cot_filter','Neutral',1),('cot_filter','Bearish',2),
      ('htf_bias','Bullish',0),('htf_bias','Neutral',1),('htf_bias','Bearish',2),
      ('entry_tf','1m',0),('entry_tf','5m',1),('entry_tf','15m',2),('entry_tf','1h',3),('entry_tf','4h',4),('entry_tf','1D',5),
      ('technical_tag','FVG',0),('technical_tag','Order Block',1),('technical_tag','Liquidity Sweep',2),('technical_tag','Breaker',3),('technical_tag','BOS',4),('technical_tag','CHoCH',5),('technical_tag','Imbalance',6),('technical_tag','Equal Highs/Lows',7),
      ('setup_grade','A+',0),('setup_grade','A',1),('setup_grade','B',2),('setup_grade','C',3),
      ('risk_pct','0.25',0),('risk_pct','0.5',1),('risk_pct','1',2),('risk_pct','2',3),
      ('result','Win',0),('result','Loss',1),('result','Breakeven',2),
      ('exit_reason','Target hit',0),('exit_reason','Stop hit',1),('exit_reason','Manual',2),('exit_reason','Time stop',3),('exit_reason','Trail',4),
      ('miss_reason','No fill',0),('miss_reason','Price ran away',1),('miss_reason','Setup invalidated',2),('miss_reason','News / event',3),('miss_reason','Discretion',4),('miss_reason','Session ended',5),('miss_reason','Other',6),
      ('emotion','Discipliniran',0),('emotion','FOMO',1),('emotion','Strah',2),('emotion','Pohlepa',3),('emotion','Revenge',4),('emotion','Nestrpljiv',5),('emotion','Overconfident',6),('emotion','Umoran/rastrojen',7),
      ('discipline','Followed plan',0),('discipline','Moved stop',1),('discipline','Cut winner short',2),('discipline','Revenge',3),('discipline','Oversized',4),
      ('mistake','None',0),('mistake','Late entry',1),('mistake','Early/no confirmation',2),('mistake','Moved stop',3),('mistake','Cut winner short',4),('mistake','Oversized',5),('mistake','Chased/FOMO',6),('mistake','Against bias',7)
    ) as v(list_key, value, ord)
    join public.tj_option_lists l on l.user_id = target and l.key = v.list_key;
  end if;

  if not exists (select 1 from public.tj_field_defs where user_id = target) then
    insert into public.tj_field_defs (user_id, key, label, field_type, list_key, group_id, sort_order)
    select target, v.key, v.label, 'select', v.key, v.group_id, v.ord
    from (values
      -- Kontekst: smer i kvalitet backdrop-a, sve troje iz vault-a.
      ('macro_align','Macro Align','macro',0),
      ('cot_filter','COT Filter','macro',1),
      ('htf_bias','HTF Bias','macro',2),
      -- Setup: čime si okinuo i na kom timeframe-u.
      ('entry_tf','Entry TF','setup',0)
    ) as v(key, label, group_id, ord)
    on conflict (user_id, key) do nothing;
  end if;

  perform public.tj_seed_instruments_defaults(target);
  perform public.tj_seed_playbooks(target);
  perform public.tj_seed_tracker_rules(target);
  perform public.tj_seed_note_folders(target);
end;
$function$;
