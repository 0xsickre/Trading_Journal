-- K2: the tags are in Serbian (the trader, 29.09.2026: "sve tagove koji postoje treba prevesti
-- na srpski jezik").
--
-- WHY THE VALUE AND NOT ONLY THE LABEL. The pickers show an item's `label`, but a trade stores the
-- item's `value` (`technical_tags`, `mistake`, `psychology_tags` as text arrays, `exit_reason`,
-- `miss_reason` as text, a custom field inside `custom`), and the journal grid, the reports and the
-- insights print what is stored. Translating the label alone would give a Serbian picker over an
-- English report. So both move, and every trade that carries an old value is rewritten to the new
-- one in the same transaction — the tag stays the same tag, in another language.
--
-- WHAT STAYS. Direction (`Long` / `Short`: `isShortDirection` reads it, and it is how a Serbian
-- trader says it), the bias values `Long` / `Short`, ICT abbreviations (MSS, FVG, iFVG, OTE), `FOMO`,
-- the setup grades and the entry time frames. An item whose label the trader renamed keeps that label;
-- an item the trader added keeps its value unless it is in the map below (`Backtesting` is).
--
-- The code that writes a value by name moves in the same commit: `NO_MISTAKE` and the exit reasons
-- `autoExitReason` picks (`quick-log.ts`). `tj_seed_categories` is restated from 20260929180000 with
-- the Serbian values, so a new book starts in Serbian.

CREATE TEMP TABLE tj_tag_map (list_key text, en text, sr text) ON COMMIT DROP;
INSERT INTO tj_tag_map (list_key, en, sr) VALUES
  ('htf_bias', 'Neutral', 'Neutralno'),
  ('htf_bias', 'Bullish', 'Bikovski'),
  ('htf_bias', 'Bearish', 'Medveđi'),
  ('technical_tag', 'Liquidity sweep', 'Sweep likvidnosti'),
  ('technical_tag', 'Order block', 'Order blok'),
  ('technical_tag', 'Breaker', 'Breaker blok'),
  ('technical_tag', 'SMT divergence', 'SMT divergencija'),
  ('technical_tag', 'HTF rejection close', 'HTF odbijanje na zatvaranju'),
  ('exit_reason', 'Target hit', 'Pogođen target'),
  ('exit_reason', 'Stop hit', 'Pogođen stop'),
  ('exit_reason', 'Breakeven', 'Na nuli'),
  ('exit_reason', 'Trailing stop', 'Prateći stop'),
  ('exit_reason', 'Closed early', 'Zatvoreno ranije'),
  ('exit_reason', 'Time exit', 'Izlaz po vremenu'),
  ('exit_reason', 'Flat by close', 'Zatvoreno do kraja dana'),
  ('miss_reason', 'No fill', 'Nije popunjen'),
  ('miss_reason', 'Hesitated', 'Oklevao'),
  ('miss_reason', 'Not at screen', 'Nisam bio za ekranom'),
  ('miss_reason', 'Skipped by rules', 'Preskočen po pravilima'),
  ('miss_reason', 'News / event', 'Vesti / događaj'),
  ('emotion', 'Calm', 'Smiren'),
  ('emotion', 'Fear', 'Strah'),
  ('emotion', 'Revenge', 'Osveta'),
  ('emotion', 'Impatient', 'Nestrpljiv'),
  ('emotion', 'Overconfident', 'Previše samouveren'),
  ('emotion', 'Tired', 'Umoran'),
  ('emotion', 'Backtesting', 'Bektest'),
  ('discipline', 'Followed plan', 'Ispoštovao plan'),
  ('discipline', 'Respected risk', 'Ispoštovao rizik'),
  ('discipline', 'Managed by plan', 'Vodio po planu'),
  ('mistake', 'No mistake', 'Bez greške'),
  ('mistake', 'Early entry', 'Rani ulaz'),
  ('mistake', 'Chased price', 'Jurio cenu'),
  ('mistake', 'Moved stop', 'Pomerio stop'),
  ('mistake', 'Cut winner early', 'Rano zatvorio dobitak'),
  ('mistake', 'Overmanaged', 'Previše upravljao'),
  ('mistake', 'Oversized', 'Prevelika pozicija'),
  ('mistake', 'Against HTF bias', 'Protiv HTF biasa'),
  ('mistake', 'Counter HTF trend', 'Protiv HTF trenda'),
  ('mistake', 'Overtrading', 'Previše trejdova'),
  ('mistake', 'Trade after DLL plan', 'Trejd posle DLL plana'),
  ('mistake', 'Revenge re-entry', 'Osvetnički ponovni ulaz'),
  ('mistake', 'Traded red window', 'Trejd u crvenom prozoru');

-- 1) The items. Skipped where the list already holds the Serbian value, so a rerun is a no-op.
UPDATE public.tj_option_items i
   SET value = m.sr,
       label = CASE WHEN i.label = m.en THEN m.sr ELSE i.label END
  FROM public.tj_option_lists l, tj_tag_map m
 WHERE i.list_id = l.id
   AND l.key = m.list_key
   AND i.value = m.en
   AND NOT EXISTS (
     SELECT 1 FROM public.tj_option_items x WHERE x.list_id = i.list_id AND x.value = m.sr
   );

-- 2) The trades. Arrays keep their order; a value with no entry in the map is left as it is.
UPDATE public.tj_positions p
   SET technical_tags = ARRAY(
         SELECT COALESCE((SELECT m.sr FROM tj_tag_map m WHERE m.list_key = 'technical_tag' AND m.en = u.t), u.t)
           FROM unnest(p.technical_tags) WITH ORDINALITY AS u(t, o) ORDER BY u.o)
 WHERE p.technical_tags && ARRAY(SELECT en FROM tj_tag_map WHERE list_key = 'technical_tag');

UPDATE public.tj_positions p
   SET mistake = ARRAY(
         SELECT COALESCE((SELECT m.sr FROM tj_tag_map m WHERE m.list_key = 'mistake' AND m.en = u.t), u.t)
           FROM unnest(p.mistake) WITH ORDINALITY AS u(t, o) ORDER BY u.o)
 WHERE p.mistake && ARRAY(SELECT en FROM tj_tag_map WHERE list_key = 'mistake');

-- `psychology_tags` draws from two lists, the emotions and the discipline items.
UPDATE public.tj_positions p
   SET psychology_tags = ARRAY(
         SELECT COALESCE((SELECT m.sr FROM tj_tag_map m
                           WHERE m.list_key IN ('emotion', 'discipline') AND m.en = u.t), u.t)
           FROM unnest(p.psychology_tags) WITH ORDINALITY AS u(t, o) ORDER BY u.o)
 WHERE p.psychology_tags && ARRAY(SELECT en FROM tj_tag_map WHERE list_key IN ('emotion', 'discipline'));

UPDATE public.tj_positions p
   SET exit_reason = m.sr
  FROM tj_tag_map m
 WHERE m.list_key = 'exit_reason' AND p.exit_reason = m.en;

UPDATE public.tj_positions p
   SET miss_reason = m.sr
  FROM tj_tag_map m
 WHERE m.list_key = 'miss_reason' AND p.miss_reason = m.en;

-- The day's bias is a custom field (`htf_bias`), stored inside `custom`.
UPDATE public.tj_positions p
   SET custom = jsonb_set(p.custom, '{htf_bias}', to_jsonb(m.sr))
  FROM tj_tag_map m
 WHERE m.list_key = 'htf_bias' AND p.custom ->> 'htf_bias' = m.en;

-- 3) The seed for a new book.
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
      ('entry_tf','1m',0),('entry_tf','2m',1),('entry_tf','5m',2),('entry_tf','15m',3),
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
