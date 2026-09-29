-- Four automatic tracker rules for a day trader (F4, decisions G5, G7, G8, G9).
--
-- WHY. The trader's own manual rules already said "at most two trades a day",
-- "no entry fifteen minutes around red news" and "stop at the daily loss" — as
-- boxes to tick at night, answered from memory. The journal has every entry,
-- exit and result, and since 20260929100000 the morning brief's red windows and
-- Topstep close, so all of them can be scored from data:
--
--   max_trades_per_day      at most N entries per ACCOUNT on a Topstep day (G9);
--                           config {"count": N}, seeded at 2.
--   stop_after_losses       no entry after N consecutive losses on the same
--                           account that day, counting only losses that had
--                           closed before the entry (G9); config {"count": N},
--                           seeded at 2.
--   flat_by_close           every Topstep position flat by that Topstep day's
--                           close: the brief's time (holiday, early close),
--                           else 15:10 CT.
--   no_entry_in_red_window  no entry inside a red window of the day's brief —
--                           the brief's own windows only (G7); without a brief
--                           the rule grades nothing.
--
-- The evaluators live in `src/lib/journal/tracker/auto-rules.ts`; this file
-- only widens the closed set, bounds the new config and hands the rules out.

-- 1) Widen the CHECK --------------------------------------------------------

ALTER TABLE public.tj_tracker_rules
  DROP CONSTRAINT IF EXISTS tj_tracker_rules_auto_key_check;

ALTER TABLE public.tj_tracker_rules
  ADD CONSTRAINT tj_tracker_rules_auto_key_check
  CHECK (auto_key = ANY (ARRAY[
    'max_loss_per_trade', 'max_loss_per_day', 'max_loss_per_week',
    'playbook_linked', 'stop_loss_set', 'thesis_written',
    'risk_per_trade', 'risk_matched_intent',
    'max_trades_per_day', 'stop_after_losses', 'flat_by_close', 'no_entry_in_red_window'
  ]));

-- 2) A count is a whole number from 1 to 20 --------------------------------
--
-- The same guard the app's zod schema applies, held where it cannot be walked
-- around: PostgREST with the user's JWT is a live write path.

ALTER TABLE public.tj_tracker_rules
  DROP CONSTRAINT IF EXISTS tj_tracker_rules_count_is_whole;

ALTER TABLE public.tj_tracker_rules
  ADD CONSTRAINT tj_tracker_rules_count_is_whole
  CHECK (
    (config -> 'count') IS NULL
    OR (
      jsonb_typeof(config -> 'count') = 'number'
      AND (config ->> 'count')::numeric = floor((config ->> 'count')::numeric)
      AND (config ->> 'count')::numeric BETWEEN 1 AND 20
    )
  );

-- 3) The seed for a new book ------------------------------------------------
--
-- Body as in 20260920170000 with four rows added. `create or replace` keeps the
-- privileges, so the REVOKE is not repeated (see that migration).

CREATE OR REPLACE FUNCTION public.tj_seed_tracker_rules(target uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if exists (select 1 from public.tj_tracker_rules where user_id = target) then
    return;
  end if;

  insert into public.tj_tracker_rules (user_id, text, stage, auto_key, config, is_mandatory, sort_order)
  select target, v.text, v.stage, v.auto_key, v.config::jsonb, true, v.ord
  from (values
    ('Počni dan po ritualu (priprema pre otvaranja)', 'prepare', null,                     '{}',            0),
    ('Trgujem samo u definisanim satima',             'trade',   null,                     '{}',            1),
    ('Svaki trejd vezan za playbook',                 'trade',   'playbook_linked',        '{}',            2),
    ('Svaki trejd ima unet stop loss',                'trade',   'stop_loss_set',          '{}',            3),
    ('Every trade has a written thesis',              'trade',   'thesis_written',         '{}',            4),
    ('Net max gubitak po trejdu',                     'trade',   'max_loss_per_trade',     '{}',            5),
    ('Net max gubitak po danu',                       'trade',   'max_loss_per_day',       '{}',            6),
    ('Net max gubitak po nedelji',                    'trade',   'max_loss_per_week',      '{}',            7),
    ('Max risk per trade at entry',                   'trade',   'risk_per_trade',         '{}',            8),
    ('Every trade sized to its planned risk',         'trade',   'risk_matched_intent',    '{}',            9),
    ('Dnevni limit ulaza po nalogu',                  'trade',   'max_trades_per_day',     '{"count": 2}', 10),
    ('Stop posle uzastopnih gubitaka',                'trade',   'stop_after_losses',      '{"count": 2}', 11),
    ('Ravno do kraja Topstep dana',                   'trade',   'flat_by_close',          '{}',           12),
    ('Bez ulaza u crvenom prozoru vesti (brief)',     'trade',   'no_entry_in_red_window', '{}',           13)
  ) as v(text, stage, auto_key, config, ord);
end;
$function$;

-- 4) Existing books get them too --------------------------------------------
--
-- The seed only runs for a book with NO rules. After the last existing rule
-- rather than at a fixed ordinal, so an order the trader chose is not shuffled.
-- `created_at` is now: a rule added today must not fail a year of past days.

INSERT INTO public.tj_tracker_rules
  (user_id, text, stage, auto_key, config, is_mandatory, sort_order)
SELECT
  r.user_id,
  v.text,
  'trade',
  v.auto_key,
  v.config::jsonb,
  true,
  COALESCE(MAX(r.sort_order), 0) + v.offset_ord
FROM public.tj_tracker_rules r
CROSS JOIN (values
  ('Dnevni limit ulaza po nalogu',              'max_trades_per_day',     '{"count": 2}', 1),
  ('Stop posle uzastopnih gubitaka',            'stop_after_losses',      '{"count": 2}', 2),
  ('Ravno do kraja Topstep dana',               'flat_by_close',          '{}',           3),
  ('Bez ulaza u crvenom prozoru vesti (brief)', 'no_entry_in_red_window', '{}',           4)
) AS v(text, auto_key, config, offset_ord)
GROUP BY r.user_id, v.text, v.auto_key, v.config, v.offset_ord
HAVING NOT EXISTS (
  SELECT 1 FROM public.tj_tracker_rules x
  WHERE x.user_id = r.user_id AND x.auto_key = v.auto_key
);

-- 5) The manual rules they replace are retired (G8) -------------------------
--
-- RETIRED, not deleted: `deleted_at` is the cutoff compliance reads, so every
-- past day they were live on keeps its score and its answers. Matched on the
-- opening words of the trader's own text — a book that never had them is
-- untouched. "Walk Away Target" stays manual (G5).

UPDATE public.tj_tracker_rules
   SET deleted_at = now()
 WHERE auto_key IS NULL
   AND deleted_at IS NULL
   AND (
     text LIKE 'Dnevni limit trejdova:%'
     OR text LIKE 'Nema otvaranja novih pozicija 15 minuta pre i 15 minuta nakon%'
     OR text LIKE 'Max Daily Loss (USD Limit):%'
   );
