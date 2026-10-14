-- Phase Q (14.10.2026): the manual ticks the trade page already answers become scored rules.
--
-- WHY. On 13.10.2026 the trader ticked "Teza naglas" for a day whose second trade had its
-- thesis spoken AFTER the click, and left "Dnevnik i tagovi" and "Screenshotovi" unticked
-- although both trades had every tag and two charts each. A tick for the whole day says less
-- than the trade page already says per trade, and it can say the opposite. The trader agreed
-- (14.10.2026, decision Q-2) to:
--   * HTF nivoi i bias  -> `htf_bias_set`         (Bias dana on every trade, never "Nisam odredio unapred")
--   * Teza naglas       -> `thesis_recorded`      (what was said before the click is written on every trade;
--                                                   WHEN it was said stays the recording's, i.e. the mentor's)
--   * Iskreni tagovi    -> `honest_tags`          (a tag a failed rule on the same trade says is untrue)
--   * Dnevnik i tagovi  -> `review_complete`
--   * Screenshotovi     -> `screenshot_per_trade`
--   * Vreme trgovanja   -> retired, not scored: "nepotrebno" — the window is the weekly shift, and the
--                          mentor checks it from the fills.
-- Evaluators: `tracker/auto-rules.ts`. As on 08.10.2026, each manual rule is retired (kept,
-- `deleted_at`) and the scored one takes its place, so past days keep the verdicts they had
-- (`tracker/compliance.ts` reads `created_at` / `deleted_at` as the rule's life).

ALTER TABLE public.tj_tracker_rules DROP CONSTRAINT IF EXISTS tj_tracker_rules_auto_key_check;
ALTER TABLE public.tj_tracker_rules ADD CONSTRAINT tj_tracker_rules_auto_key_check
  CHECK (auto_key = ANY (ARRAY['max_loss_per_trade', 'max_loss_per_day', 'playbook_linked', 'stop_loss_set',
    'thesis_written', 'risk_per_trade', 'risk_matched_intent', 'flat_by_close', 'no_entry_in_red_window',
    'no_entry_after_daily_target', 'stop_after_two_losses',
    'htf_bias_set', 'thesis_recorded', 'honest_tags', 'review_complete', 'screenshot_per_trade']));

-- The scored rules, per user that had the manual one live, in its place in the order.
INSERT INTO public.tj_tracker_rules (user_id, text, stage, auto_key, config, is_mandatory, sort_order, active_days)
SELECT m.user_id, v.text, m.stage, v.auto_key, '{}'::jsonb, m.is_mandatory, m.sort_order, m.active_days
  FROM public.tj_tracker_rules m
  JOIN (VALUES
    ('HTF nivoi i bias%', 'htf_bias_set',
     'HTF nivoi i bias: na svakom trejdu upisan bias dana (gore, dole ili nema ga), nikad „Nisam odredio unapred“.'),
    ('Teza naglas%', 'thesis_recorded',
     'Teza naglas: na svakom trejdu upisano šta sam rekao pre klika.'),
    ('Iskreni tagovi%', 'honest_tags',
     'Iskreni tagovi: nijedan tag se ne sukobljava sa automatskim pravilom na istom trejdu („Ispoštovao rizik“ uz pao rizik ili stop, ocena A uz prekršeno pravilo).'),
    ('Dnevnik i tagovi%', 'review_complete',
     'Dnevnik i tagovi: svaki trejd ima ocenu, razlog izlaska, bias, Entry TF, emociju i grešku ili ocenu A.'),
    ('Screenshotovi%', 'screenshot_per_trade',
     'Screenshotovi: svaki trejd ima bar jednu sliku charta.')
  ) AS v(pattern, auto_key, text) ON m.text LIKE v.pattern
 WHERE m.auto_key IS NULL
   AND m.deleted_at IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.tj_tracker_rules x
      WHERE x.user_id = m.user_id AND x.auto_key = v.auto_key AND x.deleted_at IS NULL
   );

-- Then the manual ones retire, "Vreme trgovanja" with them.
UPDATE public.tj_tracker_rules
   SET deleted_at = now()
 WHERE auto_key IS NULL
   AND deleted_at IS NULL
   AND (text LIKE 'HTF nivoi i bias%' OR text LIKE 'Teza naglas%' OR text LIKE 'Iskreni tagovi%'
        OR text LIKE 'Dnevnik i tagovi%' OR text LIKE 'Screenshotovi%' OR text LIKE 'Vreme trgovanja%');
