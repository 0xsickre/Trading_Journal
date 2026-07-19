-- Simplify trade form: technical_tags + trade_journal_notes; drop redundant columns.

-- 1) New columns
ALTER TABLE public.tj_positions
  ADD COLUMN IF NOT EXISTS technical_tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS trade_journal_notes text;

-- 2) Migrate existing trade data
UPDATE public.tj_positions
SET technical_tags = COALESCE((
  SELECT ARRAY(
    SELECT DISTINCT tag
    FROM unnest(
      COALESCE(confluences, '{}') ||
      COALESCE(setup_tags, '{}') ||
      CASE WHEN premium_discount IS NOT NULL THEN ARRAY['PD: ' || premium_discount] ELSE '{}' END ||
      CASE WHEN ipda_range IS NOT NULL THEN ARRAY['IPDA: ' || ipda_range] ELSE '{}' END ||
      CASE WHEN smt_divergence IS NOT NULL THEN ARRAY['SMT: ' || smt_divergence] ELSE '{}' END
    ) AS tag
    WHERE tag IS NOT NULL AND btrim(tag) <> ''
  )
), '{}');

UPDATE public.tj_positions
SET trade_journal_notes = NULLIF(btrim(concat_ws(E'\n\n',
  CASE WHEN stop_logic IS NOT NULL THEN 'Stop: ' || stop_logic END,
  CASE WHEN target_logic IS NOT NULL THEN 'Target: ' || target_logic END,
  notes,
  CASE WHEN lesson_learned IS NOT NULL THEN 'Lesson: ' || lesson_learned END
)), '');

-- 3) Drop legacy columns
ALTER TABLE public.tj_positions
  DROP COLUMN IF EXISTS confluences,
  DROP COLUMN IF EXISTS setup_tags,
  DROP COLUMN IF EXISTS conviction,
  DROP COLUMN IF EXISTS premium_discount,
  DROP COLUMN IF EXISTS draw_on_liquidity,
  DROP COLUMN IF EXISTS ipda_range,
  DROP COLUMN IF EXISTS smt_divergence,
  DROP COLUMN IF EXISTS stop_logic,
  DROP COLUMN IF EXISTS target_logic,
  DROP COLUMN IF EXISTS notes,
  DROP COLUMN IF EXISTS lesson_learned;

-- 4) Option lists: create technical_tag for existing users from deprecated lists
INSERT INTO public.tj_option_lists (user_id, key, label, category, sort_order)
SELECT DISTINCT ol.user_id, 'technical_tag', 'Technical Tags', 'ICT Setup', 6
FROM public.tj_option_lists ol
WHERE NOT EXISTS (
  SELECT 1 FROM public.tj_option_lists x
  WHERE x.user_id = ol.user_id AND x.key = 'technical_tag'
);

INSERT INTO public.tj_option_items (user_id, list_id, value, label, sort_order)
SELECT DISTINCT ol.user_id, tl.id, oi.value, oi.label, oi.sort_order
FROM public.tj_option_items oi
JOIN public.tj_option_lists ol ON ol.id = oi.list_id
JOIN public.tj_option_lists tl ON tl.user_id = ol.user_id AND tl.key = 'technical_tag'
WHERE ol.key IN (
  'confluence', 'market_structure', 'entry_poi',
  'premium_discount', 'ipda_range', 'smt_divergence'
)
AND NOT EXISTS (
  SELECT 1 FROM public.tj_option_items x
  WHERE x.list_id = tl.id AND x.value = oi.value
);

DELETE FROM public.tj_option_items
WHERE list_id IN (
  SELECT id FROM public.tj_option_lists
  WHERE key IN (
    'conviction', 'draw_on_liquidity', 'stop_logic', 'target_logic',
    'confluence', 'market_structure', 'entry_poi',
    'premium_discount', 'ipda_range', 'smt_divergence', 'num_confluences'
  )
);

DELETE FROM public.tj_option_lists
WHERE key IN (
  'conviction', 'draw_on_liquidity', 'stop_logic', 'target_logic',
  'confluence', 'market_structure', 'entry_poi',
  'premium_discount', 'ipda_range', 'smt_divergence', 'num_confluences'
);

-- 5) Patch tj_seed_defaults for new signups (journal-only lists)
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
      ('trade_type','Trade Type','Context',1),
      ('session_killzone','Session / Killzone','Context',2),
      ('htf_bias','HTF Bias','Context',3),
      ('bias_tf','Bias TF','Context',4),
      ('entry_tf','Entry TF','Context',5),
      ('technical_tag','Technical Tags','ICT Setup',6),
      ('ict_entry_model','ICT Entry Model','ICT Setup',7),
      ('entry_trigger','Entry Trigger','ICT Setup',8),
      ('setup_grade','Setup Grade','ICT Setup',9),
      ('risk_pct','Risk %','Risk',10),
      ('planned_rr','Planned R:R','Risk',11),
      ('result','Result','Risk',12),
      ('exit_reason','Exit Reason','Risk',13),
      ('duration','Duration','Risk',14),
      ('emotion_before','Emotion Before','Psychology',15),
      ('emotion_during','Emotion During','Psychology',16),
      ('emotion_after','Emotion After','Psychology',17),
      ('discipline','Discipline / Behavior','Psychology',18),
      ('mistake','Mistake','Psychology',19),
      ('rules_followed','Rules Followed','Psychology',20),
      ('market_condition','Market Condition','Psychology',21),
      ('vix_regime','VIX Regime','Psychology',22),
      ('news_nearby','News Nearby','Psychology',23)
    ) as v(key, label, category, sort_order);

    insert into public.tj_option_items (user_id, list_id, value, label, sort_order)
    select target, l.id, v.value, v.value, v.ord
    from (values
      ('direction','Long',0),('direction','Short',1),
      ('trade_type','Swing',0),('trade_type','Day Trade',1),('trade_type','Scalp',2),('trade_type','Position',3),
      ('htf_bias','Bullish',0),('htf_bias','Bearish',1),('htf_bias','Neutral / Ranging',2),
      ('bias_tf','Monthly',0),('bias_tf','Weekly',1),('bias_tf','Daily',2),('bias_tf','4H',3),
      ('entry_tf','4H',0),('entry_tf','1H',1),('entry_tf','30m',2),('entry_tf','15m',3),('entry_tf','5m',4),('entry_tf','3m',5),('entry_tf','1m',6),
      ('technical_tag','Bullish (HH/HL)',0),('technical_tag','Bearish (LH/LL)',1),('technical_tag','Bullish BOS',2),('technical_tag','Bearish BOS',3),
      ('technical_tag','MSS Bullish (CHoCH)',4),('technical_tag','MSS Bearish (CHoCH)',5),('technical_tag','Consolidation / Range',6),
      ('technical_tag','Discount (<50%)',7),('technical_tag','Equilibrium (50%)',8),('technical_tag','Premium (>50%)',9),
      ('technical_tag','20-Day',10),('technical_tag','40-Day',11),('technical_tag','60-Day',12),
      ('technical_tag','Bullish Order Block',13),('technical_tag','Bearish Order Block',14),('technical_tag','Fair Value Gap (BISI)',15),('technical_tag','Fair Value Gap (SIBI)',16),
      ('technical_tag','Liquidity swept first',17),('technical_tag','FVG aligned',18),('technical_tag','Order Block aligned',19),('technical_tag','OTE zone',20),
      ('technical_tag','Multi-TF alignment',21),('technical_tag','Killzone timing',22),('technical_tag','EQH/EQL taken',23),
      ('technical_tag','Yes - Bullish',24),('technical_tag','Yes - Bearish',25),('technical_tag','No',26),
      ('ict_entry_model','2022 Model (Sweep > MSS > FVG)',0),('ict_entry_model','Unicorn (Breaker + FVG)',1),('ict_entry_model','Optimal Trade Entry (OTE)',2),
      ('ict_entry_model','Order Block Entry',3),('ict_entry_model','FVG Entry',4),('ict_entry_model','Breaker Entry',5),('ict_entry_model','Liquidity Raid + MSS',6),
      ('entry_trigger','MSS on LTF (CHoCH)',0),('entry_trigger','Displacement candle close',1),('entry_trigger','FVG formed + retest',2),('entry_trigger','Order Block respected',3),('entry_trigger','Liquidity sweep + rejection',4),
      ('setup_grade','A+',0),('setup_grade','A',1),('setup_grade','B',2),('setup_grade','C',3),('setup_grade','D',4),
      ('risk_pct','0.25%',0),('risk_pct','0.5%',1),('risk_pct','0.75%',2),('risk_pct','1%',3),('risk_pct','1.5%',4),('risk_pct','2%',5),
      ('planned_rr','1:1',0),('planned_rr','1:1.5',1),('planned_rr','1:2',2),('planned_rr','1:3',3),('planned_rr','1:4',4),('planned_rr','1:5+',5),
      ('result','Win',0),('result','Loss',1),('result','Breakeven',2),('result','Partial Win',3),('result','Partial Loss',4),('result','Scratch',5),
      ('exit_reason','TP hit',0),('exit_reason','SL hit',1),('exit_reason','Manual close (profit)',2),('exit_reason','Manual close (loss)',3),('exit_reason','Breakeven stop',4),
      ('discipline','Followed plan fully',0),('discipline','Moved stop loss',1),('discipline','Revenge trade',2),
      ('mistake','None / Clean execution',0),('mistake','Late entry',1),('mistake','FOMO entry',2),
      ('market_condition','Trending Up',0),('market_condition','Ranging / Consolidating',1),('market_condition','Volatile / Choppy',2),
      ('vix_regime','Low (<15)',0),('vix_regime','Normal (15-20)',1),('vix_regime','Elevated (20-30)',2),('vix_regime','High (>30)',3),
      ('news_nearby','None',0),('news_nearby','FOMC',1),('news_nearby','CPI',2),('news_nearby','NFP / Jobs',3)
    ) as v(list_key, value, ord)
    join public.tj_option_lists l on l.user_id = target and l.key = v.list_key;
  end if;

  perform public.tj_seed_instruments_defaults(target);
end;
$function$;
