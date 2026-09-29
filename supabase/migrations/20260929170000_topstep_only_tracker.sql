-- H2.4a: the tracker's money rules read the Topstep plan only (decision
-- 29.09.2026, I4-A).
--
-- WHY. Since F3 a Topstep account's daily loss, loss per trade and risk per
-- trade are graded by its plan (the DLL, the budget at entry); the percentage
-- of equity in `config.pct` graded only the other accounts, and since H1 there
-- are none. The weekly loss had no Topstep counterpart at all — Topstep has no
-- weekly limit — so it could only ever answer "not on Topstep". The trader:
-- "ništa od ovog mi ne treba".
--
-- WHAT CHANGES.
--   1. `max_loss_per_week` rows are DELETED, not retired: on 29.09.2026 they
--      carried no check-in, so there is no past day whose score they are part
--      of, and the key leaves the CHECK below, which a retired row would block.
--   2. `pct` leaves every config, and its CHECK goes. `count` (F4) stays.
--   3. The closed set loses `max_loss_per_week`.
--   4. The three rules still named in English get their Serbian names — only
--      where the text is still the seeded one, so a rule the trader renamed
--      keeps his words.
--   5. The seed for a new book: as in 20260929110000, without the weekly rule
--      and with the Serbian names.

-- 1) The weekly rule -----------------------------------------------------------

DELETE FROM public.tj_tracker_checkins c
 USING public.tj_tracker_rules r
 WHERE c.rule_id = r.id
   AND r.auto_key = 'max_loss_per_week';

DELETE FROM public.tj_tracker_rules WHERE auto_key = 'max_loss_per_week';

-- 2) No percentage -------------------------------------------------------------

UPDATE public.tj_tracker_rules
   SET config = config - 'pct'
 WHERE config ? 'pct';

ALTER TABLE public.tj_tracker_rules
  DROP CONSTRAINT IF EXISTS tj_tracker_rules_pct_is_number;

-- 3) The closed set ------------------------------------------------------------

ALTER TABLE public.tj_tracker_rules
  DROP CONSTRAINT IF EXISTS tj_tracker_rules_auto_key_check;

ALTER TABLE public.tj_tracker_rules
  ADD CONSTRAINT tj_tracker_rules_auto_key_check
  CHECK (auto_key = ANY (ARRAY[
    'max_loss_per_trade', 'max_loss_per_day',
    'playbook_linked', 'stop_loss_set', 'thesis_written',
    'risk_per_trade', 'risk_matched_intent',
    'max_trades_per_day', 'stop_after_losses', 'flat_by_close', 'no_entry_in_red_window'
  ]));

-- 4) Serbian names -------------------------------------------------------------

UPDATE public.tj_tracker_rules SET text = 'Svaki trejd ima tezu napisanu pre ulaza'
 WHERE auto_key = 'thesis_written' AND text = 'Every trade has a written thesis';
UPDATE public.tj_tracker_rules SET text = 'Rizik na ulazu u okviru budžeta'
 WHERE auto_key = 'risk_per_trade' AND text = 'Max risk per trade at entry';
UPDATE public.tj_tracker_rules SET text = 'Broj ugovora po budžetu rizika'
 WHERE auto_key = 'risk_matched_intent' AND text = 'Every trade sized to its planned risk';

-- 5) The seed for a new book ---------------------------------------------------
--
-- `create or replace` keeps the privileges, so the REVOKE is not repeated.

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
    ('Svaki trejd ima tezu napisanu pre ulaza',       'trade',   'thesis_written',         '{}',            4),
    ('Net max gubitak po trejdu',                     'trade',   'max_loss_per_trade',     '{}',            5),
    ('Net max gubitak po danu',                       'trade',   'max_loss_per_day',       '{}',            6),
    ('Rizik na ulazu u okviru budžeta',               'trade',   'risk_per_trade',         '{}',            7),
    ('Broj ugovora po budžetu rizika',                'trade',   'risk_matched_intent',    '{}',            8),
    ('Dnevni limit ulaza po nalogu',                  'trade',   'max_trades_per_day',     '{"count": 2}',  9),
    ('Stop posle uzastopnih gubitaka',                'trade',   'stop_after_losses',      '{"count": 2}', 10),
    ('Ravno do kraja Topstep dana',                   'trade',   'flat_by_close',          '{}',           11),
    ('Bez ulaza u crvenom prozoru vesti (brief)',     'trade',   'no_entry_in_red_window', '{}',           12)
  ) as v(text, stage, auto_key, config, ord);
end;
$function$;
