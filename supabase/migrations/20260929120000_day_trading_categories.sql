-- Categories for a day trader (F4, decisions G4-A and G10, 28.09.2026).
--
-- The lists were the swing set: entries on 15m to 1D, an HTF bias, and
-- mistakes a swing trader makes ("Overmanaged", "Against HTF bias"). A day
-- trader on NQ / ES enters on 1m to 15m, reads the day's bias off the morning
-- brief, and makes different mistakes: a third trade, a trade after the loss
-- plan said stop, a revenge re-entry, an entry inside a red window.
--
-- ADDED AND SWITCHED OFF, NEVER DELETED. Trades store a tag as TEXT, so
-- deleting an item would not touch a single trade — but it would take the item
-- out of Settings while old trades still carry it, and a report grouped by it
-- would show a value nobody can find any more. `is_active = false` keeps it
-- readable on the trades that have it and stops offering it for new ones.
--
--   Entry TF          + 1m, 2m                 off: 1h, 4h, 1D, and "15" (a duplicate of "15m", G10)
--   HTF Bias          renamed "Bias dana (brief)" — only where the trader has
--                     not renamed it; + Long, Short     off: Bullish, Bearish
--   Exit Reason       + Flat by close          "Time exit" stays (G10)
--   Mistake           + Overtrading, Trade after DLL plan, Revenge re-entry,
--                       Traded red window      off: Overmanaged, Against HTF bias, Counter HTF trend
--
-- The seed for a new book gets the same set, without the switched-off items.

create or replace function public.tj_seed_categories(target uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
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
      ('risk_pct','Risk %','Risk',5),
      ('exit_reason','Exit Reason','Risk',6),
      ('miss_reason','Miss Reason','Risk',7),
      ('emotion','Emotion','Psychology',8),
      ('discipline','Discipline','Psychology',9),
      ('mistake','Mistake','Psychology',10)
    ) as v(key, label, category, sort_order);

    insert into public.tj_option_items (user_id, list_id, value, label, sort_order)
    select target, l.id, v.value, v.value, v.ord
    from (values
      ('direction','Long',0),('direction','Short',1),
      ('htf_bias','Long',0),('htf_bias','Short',1),('htf_bias','Neutral',2),
      ('entry_tf','1m',0),('entry_tf','2m',1),('entry_tf','5m',2),('entry_tf','15m',3),
      ('technical_tag','Liquidity sweep',0),('technical_tag','MSS',1),('technical_tag','FVG',2),
      ('technical_tag','iFVG',3),('technical_tag','Order block',4),('technical_tag','Breaker',5),
      ('technical_tag','OTE',6),('technical_tag','SMT divergence',7),('technical_tag','HTF rejection close',8),
      ('setup_grade','A+',0),('setup_grade','A',1),('setup_grade','B',2),('setup_grade','C',3),
      ('risk_pct','0.25',0),('risk_pct','0.5',1),('risk_pct','0.75',2),('risk_pct','1',3),
      ('exit_reason','Target hit',0),('exit_reason','Stop hit',1),('exit_reason','Breakeven',2),
      ('exit_reason','Trailing stop',3),('exit_reason','Closed early',4),('exit_reason','Time exit',5),
      ('exit_reason','Flat by close',6),
      ('miss_reason','No fill',0),('miss_reason','Hesitated',1),('miss_reason','Not at screen',2),
      ('miss_reason','Skipped by rules',3),('miss_reason','News / event',4),
      ('emotion','Calm',0),('emotion','FOMO',1),('emotion','Fear',2),('emotion','Revenge',3),
      ('emotion','Impatient',4),('emotion','Overconfident',5),('emotion','Tired',6),
      ('discipline','Followed plan',0),('discipline','Respected risk',1),('discipline','Managed by plan',2),
      ('mistake','No mistake',0),('mistake','Early entry',1),('mistake','Chased price',2),
      ('mistake','Moved stop',3),('mistake','Cut winner early',4),('mistake','Oversized',5),
      ('mistake','Overtrading',6),('mistake','Trade after DLL plan',7),('mistake','Revenge re-entry',8),
      ('mistake','Traded red window',9)
    ) as v(list_key, value, ord)
    join public.tj_option_lists l on l.user_id = target and l.key = v.list_key;

    -- Inside the same guard as the lists: `ensureDefaults` runs this on every
    -- visit to the home page, and a category the trader deleted must not come
    -- back on the next one.
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


-- Existing books ---------------------------------------------------------

-- New items, after the list's last one, only where the value is not there yet.
INSERT INTO public.tj_option_items (user_id, list_id, value, label, sort_order)
SELECT l.user_id, l.id, v.value, v.value,
       COALESCE((SELECT MAX(i.sort_order) FROM public.tj_option_items i WHERE i.list_id = l.id), -1) + v.ord
FROM public.tj_option_lists l
JOIN (values
  ('entry_tf',    '1m',                   1),
  ('entry_tf',    '2m',                   2),
  ('htf_bias',    'Long',                 1),
  ('htf_bias',    'Short',                2),
  ('exit_reason', 'Flat by close',        1),
  ('mistake',     'Overtrading',          1),
  ('mistake',     'Trade after DLL plan', 2),
  ('mistake',     'Revenge re-entry',     3),
  ('mistake',     'Traded red window',    4)
) AS v(list_key, value, ord) ON v.list_key = l.key
WHERE NOT EXISTS (
  SELECT 1 FROM public.tj_option_items x WHERE x.list_id = l.id AND x.value = v.value
);

-- Swing items switched off. Old trades keep them; new ones are not offered them.
UPDATE public.tj_option_items i
   SET is_active = false
  FROM public.tj_option_lists l
 WHERE i.list_id = l.id
   AND i.is_active
   AND (l.key, i.value) IN (
     ('entry_tf', '1h'), ('entry_tf', '4h'), ('entry_tf', '1D'), ('entry_tf', '15'),
     ('htf_bias', 'Bullish'), ('htf_bias', 'Bearish'),
     ('mistake', 'Overmanaged'), ('mistake', 'Against HTF bias'), ('mistake', 'Counter HTF trend')
   );

-- The bias is the day's, from the brief. Renamed only where it still carries the
-- seeded name: a label the trader chose is theirs.
UPDATE public.tj_option_lists SET label = 'Bias dana (brief)' WHERE key = 'htf_bias' AND label = 'HTF Bias';
UPDATE public.tj_field_defs   SET label = 'Bias dana (brief)' WHERE key = 'htf_bias' AND label = 'HTF Bias';
