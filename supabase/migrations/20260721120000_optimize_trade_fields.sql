-- Optimize trade journal fields: edge-first, drop noise, add macro linkage.
-- - Add macro_align / cot_filter / session_killzone (link journal to the vault system).
-- - Drop rarely-actionable / redundant columns: trade_type, bias_tf, entry_trigger,
--   discipline (folded into psychology_tags), market_condition.
-- - Collapse 3 emotion lists into one `emotion`; trim noisy option lists.
-- Clean slate: no data migration (no meaningful historical trades).

-- 1) Columns
ALTER TABLE public.tj_positions
  ADD COLUMN IF NOT EXISTS macro_align text,
  ADD COLUMN IF NOT EXISTS cot_filter text,
  ADD COLUMN IF NOT EXISTS session_killzone text,
  DROP COLUMN IF EXISTS trade_type,
  DROP COLUMN IF EXISTS bias_tf,
  DROP COLUMN IF EXISTS entry_trigger,
  DROP COLUMN IF EXISTS discipline,
  DROP COLUMN IF EXISTS market_condition;

-- 2) Existing users: drop removed option lists
DELETE FROM public.tj_option_items
WHERE list_id IN (
  SELECT id FROM public.tj_option_lists
  WHERE key IN ('trade_type','bias_tf','entry_trigger','planned_rr','duration',
                'market_condition','emotion_during','emotion_after')
);
DELETE FROM public.tj_option_lists
WHERE key IN ('trade_type','bias_tf','entry_trigger','planned_rr','duration',
              'market_condition','emotion_during','emotion_after');

-- 3) Rename emotion_before -> emotion (single psychology emotion list)
UPDATE public.tj_option_lists
SET key = 'emotion', label = 'Emotion'
WHERE key = 'emotion_before'
  AND NOT EXISTS (
    SELECT 1 FROM public.tj_option_lists x
    WHERE x.user_id = public.tj_option_lists.user_id AND x.key = 'emotion'
  );

-- 4) Create new lists for existing users (macro_align, cot_filter)
INSERT INTO public.tj_option_lists (user_id, key, label, category, sort_order)
SELECT DISTINCT ol.user_id, v.key, v.label, v.category, v.sort_order
FROM public.tj_option_lists ol
CROSS JOIN (values
  ('macro_align','Macro Align','Context',1),
  ('cot_filter','COT Filter','Context',2)
) AS v(key, label, category, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.tj_option_lists x
  WHERE x.user_id = ol.user_id AND x.key = v.key
);

-- 5) Reset items for all trimmed/new lists, then reinsert canonical set
DELETE FROM public.tj_option_items
WHERE list_id IN (
  SELECT id FROM public.tj_option_lists
  WHERE key IN ('macro_align','cot_filter','session_killzone','technical_tag',
                'ict_entry_model','mistake','exit_reason','discipline',
                'setup_grade','emotion','result','entry_tf')
);

INSERT INTO public.tj_option_items (user_id, list_id, value, label, sort_order)
SELECT l.user_id, l.id, v.value, v.value, v.ord
FROM (values
  ('macro_align','Uz bias',0),('macro_align','Protiv bias',1),('macro_align','Van scope',2),
  ('cot_filter','Ulaz dozvoljen',0),('cot_filter','Odložen',1),('cot_filter','Ne chase',2),
  ('session_killzone','Asia',0),('session_killzone','London Open',1),('session_killzone','NY AM',2),('session_killzone','NY PM',3),('session_killzone','London Close',4),('session_killzone','N/A (Swing)',5),
  ('entry_tf','4H',0),('entry_tf','1H',1),('entry_tf','30m',2),('entry_tf','15m',3),('entry_tf','5m',4),
  ('technical_tag','Liquidity sweep',0),('technical_tag','MSS/CHoCH',1),('technical_tag','Displacement',2),('technical_tag','FVG',3),('technical_tag','Order Block',4),('technical_tag','Breaker',5),('technical_tag','Premium/Discount OK',6),('technical_tag','OTE zone',7),('technical_tag','SMT divergence',8),('technical_tag','Killzone timing',9),('technical_tag','HTF PD overlap',10),('technical_tag','Multi-TF alignment',11),
  ('ict_entry_model','2022 Model',0),('ict_entry_model','OTE',1),('ict_entry_model','Order Block',2),('ict_entry_model','FVG',3),('ict_entry_model','Turtle Soup',4),('ict_entry_model','Silver Bullet',5),
  ('setup_grade','A+',0),('setup_grade','A',1),('setup_grade','B',2),('setup_grade','C',3),
  ('result','Win',0),('result','Loss',1),('result','Breakeven',2),('result','Partial Win',3),('result','Partial Loss',4),
  ('exit_reason','TP hit',0),('exit_reason','SL hit',1),('exit_reason','Manual (profit)',2),('exit_reason','Manual (loss)',3),('exit_reason','BE stop',4),
  ('emotion','Discipliniran',0),('emotion','FOMO',1),('emotion','Strah',2),('emotion','Pohlepa',3),('emotion','Revenge',4),('emotion','Nestrpljiv',5),('emotion','Overconfident',6),('emotion','Umoran/rastrojen',7),
  ('discipline','Followed plan',0),('discipline','Moved stop',1),('discipline','Cut winner short',2),('discipline','Revenge',3),('discipline','Oversized',4),
  ('mistake','None',0),('mistake','Late entry',1),('mistake','Early/no confirmation',2),('mistake','Moved stop',3),('mistake','Cut winner short',4),('mistake','Oversized',5),('mistake','Chased/FOMO',6),('mistake','Against bias',7)
) AS v(list_key, value, ord)
JOIN public.tj_option_lists l ON l.key = v.list_key;

-- 6) Ensure rules_followed items exist (feeds psychology_tags); reset to canonical 3
DELETE FROM public.tj_option_items
WHERE list_id IN (SELECT id FROM public.tj_option_lists WHERE key = 'rules_followed');
INSERT INTO public.tj_option_items (user_id, list_id, value, label, sort_order)
SELECT l.user_id, l.id, v.value, v.value, v.ord
FROM (values ('rules_followed','Yes',0),('rules_followed','Partial',1),('rules_followed','No',2))
  AS v(list_key, value, ord)
JOIN public.tj_option_lists l ON l.key = v.list_key;

-- 7) New-user seed authority: redefine tj_seed_defaults with the trimmed set
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
      ('session_killzone','Session / Killzone','Context',3),
      ('htf_bias','HTF Bias','Context',4),
      ('entry_tf','Entry TF','Context',5),
      ('technical_tag','Technical Tags','ICT Setup',6),
      ('ict_entry_model','ICT Entry Model','ICT Setup',7),
      ('setup_grade','Setup Grade','ICT Setup',8),
      ('risk_pct','Risk %','Risk',9),
      ('result','Result','Risk',10),
      ('exit_reason','Exit Reason','Risk',11),
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
      ('session_killzone','Asia',0),('session_killzone','London Open',1),('session_killzone','NY AM',2),('session_killzone','NY PM',3),('session_killzone','London Close',4),('session_killzone','N/A (Swing)',5),
      ('htf_bias','Bullish',0),('htf_bias','Bearish',1),('htf_bias','Neutral / Ranging',2),
      ('entry_tf','4H',0),('entry_tf','1H',1),('entry_tf','30m',2),('entry_tf','15m',3),('entry_tf','5m',4),
      ('technical_tag','Liquidity sweep',0),('technical_tag','MSS/CHoCH',1),('technical_tag','Displacement',2),('technical_tag','FVG',3),('technical_tag','Order Block',4),('technical_tag','Breaker',5),('technical_tag','Premium/Discount OK',6),('technical_tag','OTE zone',7),('technical_tag','SMT divergence',8),('technical_tag','Killzone timing',9),('technical_tag','HTF PD overlap',10),('technical_tag','Multi-TF alignment',11),
      ('ict_entry_model','2022 Model',0),('ict_entry_model','OTE',1),('ict_entry_model','Order Block',2),('ict_entry_model','FVG',3),('ict_entry_model','Turtle Soup',4),('ict_entry_model','Silver Bullet',5),
      ('setup_grade','A+',0),('setup_grade','A',1),('setup_grade','B',2),('setup_grade','C',3),
      ('risk_pct','0.25%',0),('risk_pct','0.5%',1),('risk_pct','0.75%',2),('risk_pct','1%',3),('risk_pct','1.5%',4),('risk_pct','2%',5),
      ('result','Win',0),('result','Loss',1),('result','Breakeven',2),('result','Partial Win',3),('result','Partial Loss',4),
      ('exit_reason','TP hit',0),('exit_reason','SL hit',1),('exit_reason','Manual (profit)',2),('exit_reason','Manual (loss)',3),('exit_reason','BE stop',4),
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
