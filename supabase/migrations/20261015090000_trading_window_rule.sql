-- Faza Y4 / Y5 (15.10.2026): vreme trgovanja se vraća kao automatsko pravilo, „Iskreni tagovi“ proveravaju i plan.
--
-- ZAŠTO. U fazi Q (odluka Q-2, 14.10.2026) „Vreme trgovanja“ je povučeno kao nepotrebno: prozor je proveravao mentor
-- iz fill-ova. Trejder je isti dan preko mentora tražio da ga journal meri sam („reši i ovo“), uz prozor koji se menja
-- sa nedeljom: London 09:00–12:00, NY 14:30–18:00 po Beogradu (Y-5). Prozor pamti od kog dana važi (Y-6 = A), pa
-- promena u ponedeljak ne preocenjuje prošlu nedelju. Bez pravila ulaz u 08:55 ili pozicija držana do 12:30 prolaze
-- tiho do zatvaranja dana.
--
-- ŠTA.
--   * `tj_tracker_rules_auto_key_check` dobija `trading_window`.
--   * Svaki korisnik koji ima pravila trackera dobija red `trading_window` u fazi „trade“, sa London prozorom od
--     12.10.2026 (W42). Pravilo važi od dana kad je napravljeno (`compliance.ts` čita `created_at`), pa prošli dani
--     ostaju kakvi su; zaključani su ionako zamrznuti.
--   * Tekst „Iskreni tagovi“ dopunjen uslovom koji sada proverava `tracker/auto-rules.ts` (Y5): „Vodio po planu“ na
--     trejdu bez playbook-a ili sa playbook-om napravljenim posle ulaza.

ALTER TABLE public.tj_tracker_rules DROP CONSTRAINT IF EXISTS tj_tracker_rules_auto_key_check;
ALTER TABLE public.tj_tracker_rules ADD CONSTRAINT tj_tracker_rules_auto_key_check
  CHECK (auto_key = ANY (ARRAY['max_loss_per_trade', 'max_loss_per_day', 'playbook_linked', 'stop_loss_set',
    'thesis_written', 'risk_per_trade', 'risk_matched_intent', 'flat_by_close', 'no_entry_in_red_window',
    'no_entry_after_daily_target', 'stop_after_two_losses',
    'htf_bias_set', 'thesis_recorded', 'honest_tags', 'review_complete', 'screenshot_per_trade',
    'trading_window']));

INSERT INTO public.tj_tracker_rules (user_id, text, stage, auto_key, config, is_mandatory, sort_order, active_days)
SELECT u.user_id,
       'Vreme trgovanja: svaki ulaz i izlaz u prozoru iz Settings › Tracker (po Beogradu; izlaz u minuti kraja je izlaz po vremenu).',
       'trade',
       'trading_window',
       '{"windows": [{"since": "2026-10-12", "from": "09:00", "to": "12:00"}]}'::jsonb,
       true,
       2,
       ARRAY[1, 2, 3, 4, 5]
  FROM (SELECT DISTINCT user_id FROM public.tj_tracker_rules WHERE deleted_at IS NULL) u
 WHERE NOT EXISTS (
   SELECT 1 FROM public.tj_tracker_rules x
    WHERE x.user_id = u.user_id AND x.auto_key = 'trading_window' AND x.deleted_at IS NULL
 );

UPDATE public.tj_tracker_rules
   SET text = 'Iskreni tagovi: nijedan tag se ne sukobljava sa automatskim pravilom na istom trejdu („Ispoštovao rizik“ uz pao rizik ili stop, ocena A uz prekršeno pravilo, „Vodio po planu“ bez playbook-a ili sa playbook-om napisanim posle ulaza).'
 WHERE auto_key = 'honest_tags'
   AND deleted_at IS NULL;
