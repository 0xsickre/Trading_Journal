-- LOW: finish removing session_killzone.
--
-- 20260719150000_drop_session_killzone.sql took the field out of the UI and
-- deleted its option list, but left the column on tj_positions — and then
-- 20260721130000_trade_lifecycle_missed.sql restored tj_seed_defaults from an
-- older copy that still seeds a 'session_killzone' option list, so every new
-- user got the list back for a field nothing reads.
--
-- Nothing in the application references the column: it is absent from
-- form-config, from the stats view, from the mentor pack and from every query.
-- Verified empty before dropping (0 non-null values).

ALTER TABLE public.tj_positions
  DROP COLUMN IF EXISTS session_killzone;

-- Remove the resurrected list from existing users.
DELETE FROM public.tj_option_items
WHERE list_id IN (
  SELECT id FROM public.tj_option_lists WHERE key = 'session_killzone'
);

DELETE FROM public.tj_option_lists
WHERE key = 'session_killzone';

-- Reseed function without session_killzone. This is the same body currently
-- installed, minus that list and its six items, with the remaining sort_order
-- values closed up so they stay contiguous.
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
      ('ict_entry_model','ICT Entry Model','ICT Setup',6),
      ('setup_grade','Setup Grade','ICT Setup',7),
      ('risk_pct','Risk %','Risk',8),
      ('result','Result','Risk',9),
      ('exit_reason','Exit Reason','Risk',10),
      ('miss_reason','Miss Reason','Risk',11),
      ('emotion','Emotion','Psychology',12),
      ('discipline','Discipline / Behavior','Psychology',13),
      ('rules_followed','Rules Followed','Psychology',14),
      ('mistake','Mistake','Psychology',15)
    ) as v(key, label, category, sort_order);

    insert into public.tj_option_items (user_id, list_id, value, label, sort_order)
    select target, l.id, v.value, v.value, v.ord
    from (values
      ('direction','Long',0),('direction','Short',1),
      ('macro_align','Uz bias',0),('macro_align','Protiv bias',1),('macro_align','Van scope',2),
      ('cot_filter','Ulaz dozvoljen',0),('cot_filter','Odložen',1),('cot_filter','Ne chase',2),
      ('htf_bias','Bullish',0),('htf_bias','Bearish',1),('htf_bias','Neutral / Ranging',2),
      ('entry_tf','4H',0),('entry_tf','1H',1),('entry_tf','30m',2),('entry_tf','15m',3),('entry_tf','5m',4),
      ('technical_tag','Liquidity sweep',0),('technical_tag','MSS/CHoCH',1),('technical_tag','Displacement',2),('technical_tag','FVG',3),('technical_tag','Order Block',4),('technical_tag','Breaker',5),('technical_tag','Premium/Discount OK',6),('technical_tag','OTE zone',7),('technical_tag','SMT divergence',8),('technical_tag','Killzone timing',9),('technical_tag','HTF PD overlap',10),('technical_tag','Multi-TF alignment',11),
      ('ict_entry_model','2022 Model',0),('ict_entry_model','OTE',1),('ict_entry_model','Order Block',2),('ict_entry_model','FVG',3),('ict_entry_model','Turtle Soup',4),('ict_entry_model','Silver Bullet',5),
      ('setup_grade','A+',0),('setup_grade','A',1),('setup_grade','B',2),('setup_grade','C',3),
      ('risk_pct','0.25%',0),('risk_pct','0.5%',1),('risk_pct','0.75%',2),('risk_pct','1%',3),('risk_pct','1.5%',4),('risk_pct','2%',5),
      ('result','Win',0),('result','Loss',1),('result','Breakeven',2),('result','Partial Win',3),('result','Partial Loss',4),
      ('exit_reason','TP hit',0),('exit_reason','SL hit',1),('exit_reason','Manual (profit)',2),('exit_reason','Manual (loss)',3),('exit_reason','BE stop',4),
      ('miss_reason','No fill',0),('miss_reason','Price ran away',1),('miss_reason','Setup invalidated',2),('miss_reason','News / event',3),('miss_reason','Discretion',4),('miss_reason','Session ended',5),('miss_reason','Other',6),
      ('emotion','Discipliniran',0),('emotion','FOMO',1),('emotion','Strah',2),('emotion','Pohlepa',3),('emotion','Revenge',4),('emotion','Nestrpljiv',5),('emotion','Overconfident',6),('emotion','Umoran/rastrojen',7),
      ('discipline','Followed plan',0),('discipline','Moved stop',1),('discipline','Cut winner short',2),('discipline','Revenge',3),('discipline','Oversized',4),
      ('rules_followed','Yes',0),('rules_followed','Partial',1),('rules_followed','No',2),
      ('mistake','None',0),('mistake','Late entry',1),('mistake','Early/no confirmation',2),('mistake','Moved stop',3),('mistake','Cut winner short',4),('mistake','Oversized',5),('mistake','Chased/FOMO',6),('mistake','Against bias',7)
    ) as v(list_key, value, ord)
    join public.tj_option_lists l on l.user_id = target and l.key = v.list_key;
  end if;

  perform public.tj_seed_instruments_defaults(target);
end;
$function$;
