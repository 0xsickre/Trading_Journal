-- Faza B5 + B6 (26.10.2026): psihologija jednom dnevno na /daily, kraća pravila pregleda.
--
-- ZAŠTO. Trejder: ručni rad po trejdu što manji, razmišljanje na zatvaranju dana. Psihologija se upisuje jednom
-- po danu na /daily (obavezno), a na trejdu je opciona, samo za odstupanja. Slika i rečenica se traže samo tamo
-- gde nose informaciju.
--
-- ŠTA.
--   * `tj_daily_reports.psychology_tags` (text[], prazno = nije upisano): emocije dana, iz liste `emotion`.
--   * Novo automatsko pravilo `daily_psychology` (osvrt): dan sa bar jednim trejdom bez psihologije dana = ✗.
--     Svaki korisnik sa pravilima trackera dobija red; važi od danas (`created_at`), prošli dani ostaju kakvi su.
--   * „Dnevnik i tagovi“ (`review_complete`) više ne traži TF ulaza ni psihologiju, a uz ocenu C traži rečenicu.
--   * „Screenshotovi“ (`screenshot_per_trade`): slika samo za trejd sa ocenom C i za najbolji i najgori trejd dana.
--   Zaključani dani zadržavaju zamrznute ocene.

ALTER TABLE public.tj_daily_reports ADD COLUMN IF NOT EXISTS psychology_tags text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.tj_daily_reports.psychology_tags IS
  'The day''s emotions, once per day on /daily (phase B5); empty = not written.';

ALTER TABLE public.tj_tracker_rules DROP CONSTRAINT IF EXISTS tj_tracker_rules_auto_key_check;
ALTER TABLE public.tj_tracker_rules ADD CONSTRAINT tj_tracker_rules_auto_key_check
  CHECK (auto_key = ANY (ARRAY['max_loss_per_trade', 'max_loss_per_day', 'playbook_linked', 'stop_loss_set',
    'thesis_written', 'risk_per_trade', 'risk_matched_intent', 'flat_by_close', 'no_entry_in_red_window',
    'no_entry_after_daily_target', 'stop_after_two_losses',
    'htf_bias_set', 'thesis_recorded', 'honest_tags', 'review_complete', 'screenshot_per_trade',
    'trading_window', 'daily_psychology']));

INSERT INTO public.tj_tracker_rules (user_id, text, stage, auto_key, config, is_mandatory, sort_order, active_days)
SELECT u.user_id,
       'Psihologija dana: na /daily upisano kako sam se osećao (dan sa trejdom).',
       'reflect',
       'daily_psychology',
       '{}'::jsonb,
       true,
       COALESCE((SELECT max(r.sort_order) FROM public.tj_tracker_rules r
                  WHERE r.user_id = u.user_id AND r.stage = 'reflect' AND r.deleted_at IS NULL), -1) + 1,
       ARRAY[1, 2, 3, 4, 5]
  FROM (SELECT DISTINCT user_id FROM public.tj_tracker_rules WHERE deleted_at IS NULL) u
 WHERE NOT EXISTS (
   SELECT 1 FROM public.tj_tracker_rules x
    WHERE x.user_id = u.user_id AND x.auto_key = 'daily_psychology' AND x.deleted_at IS NULL
 );

UPDATE public.tj_tracker_rules
   SET text = 'Dnevnik i tagovi: svaki trejd ima ocenu, razlog izlaza, bias dana i grešku ili ocenu A; uz ocenu C i jednu rečenicu.'
 WHERE auto_key = 'review_complete'
   AND deleted_at IS NULL;

UPDATE public.tj_tracker_rules
   SET text = 'Screenshotovi: slika charta za trejd sa ocenom C i za najbolji i najgori trejd dana.'
 WHERE auto_key = 'screenshot_per_trade'
   AND deleted_at IS NULL;
