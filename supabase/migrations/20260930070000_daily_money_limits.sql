-- Dan se zaustavlja na novcu, ne na broju trejdova (30.09.2026, trejder).
--
-- „Ne treba uopšte u journalu da se ograniči broj trejdova nikad, nego max daily
-- loss i max daily profit, jer tako ja na Topstepu. I naravno MLL.“ Kao TopstepX
-- › Risk Limits:
--
--   * tj_accounts dobija lični dnevni limit gubitka i lični dnevni cilj profita
--     (NULL = nije postavljen). Lični limit je DLL dana gde je uži od DLL-a plana;
--   * pravila `max_trades_per_day` i `stop_after_losses` se brišu (nijedno nije
--     imalo ni jedan odgovor u bazi), a dolazi `no_entry_after_daily_target`:
--     nema ulaza pošto je dan zatvorio lični cilj;
--   * tj_positions.room_at_entry: prostor iznad MLL-a na ulazu, pečaćen kao
--     risk_budget_at_entry — imenilac Risk % na Topstep nalogu;
--   * fabrička podešavanja i šabloni beleški bez broja trejdova.

ALTER TABLE public.tj_accounts
  ADD COLUMN IF NOT EXISTS topstep_personal_dll numeric,
  ADD COLUMN IF NOT EXISTS topstep_daily_target numeric;

ALTER TABLE public.tj_accounts DROP CONSTRAINT IF EXISTS tj_accounts_topstep_personal_dll_positive;
ALTER TABLE public.tj_accounts ADD CONSTRAINT tj_accounts_topstep_personal_dll_positive
  CHECK (topstep_personal_dll IS NULL OR topstep_personal_dll > 0);
ALTER TABLE public.tj_accounts DROP CONSTRAINT IF EXISTS tj_accounts_topstep_daily_target_positive;
ALTER TABLE public.tj_accounts ADD CONSTRAINT tj_accounts_topstep_daily_target_positive
  CHECK (topstep_daily_target IS NULL OR topstep_daily_target > 0);

COMMENT ON COLUMN public.tj_accounts.topstep_personal_dll IS
  'TopstepX Personal Daily Loss Limit. The day''s DLL where tighter than the plan''s; NULL = the plan''s.';
COMMENT ON COLUMN public.tj_accounts.topstep_daily_target IS
  'TopstepX Personal Daily Profit Target. No entry once the day has banked it; NULL = none.';

ALTER TABLE public.tj_positions ADD COLUMN IF NOT EXISTS room_at_entry numeric;
ALTER TABLE public.tj_positions DROP CONSTRAINT IF EXISTS tj_positions_room_at_entry_nonnegative;
ALTER TABLE public.tj_positions ADD CONSTRAINT tj_positions_room_at_entry_nonnegative
  CHECK (room_at_entry IS NULL OR room_at_entry >= 0);
COMMENT ON COLUMN public.tj_positions.room_at_entry IS
  'Topstep: room above the MLL at the first entry fill, sealed like risk_budget_at_entry. Risk %''s denominator.';

-- A Topstep trade entered before its account had closed anything, with no
-- payout yet, had the plan's whole MLL as room. Later trades stay unsealed
-- (Risk % falls back to equity) until a save seals them from the timeline.
UPDATE public.tj_positions p
   SET room_at_entry = CASE a.topstep_plan WHEN '50K' THEN 2000 WHEN '100K' THEN 3000 WHEN '150K' THEN 4500 END
  FROM public.tj_accounts a, public.tj_position_stats s
 WHERE a.id = p.account_id
   AND a.topstep_mode
   AND a.topstep_payout_at IS NULL
   AND s.position_id = p.id
   AND s.opened_at IS NOT NULL
   AND p.room_at_entry IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.tj_position_stats c
      WHERE c.account_id = p.account_id
        AND c.status = 'closed'
        AND c.closed_at < s.opened_at
        AND (a.topstep_reset_at IS NULL OR c.closed_at >= a.topstep_reset_at)
   );

-- The count rules go, with any check-in they had (none on 30.09.2026).
DELETE FROM public.tj_tracker_rules WHERE auto_key IN ('max_trades_per_day', 'stop_after_losses');

ALTER TABLE public.tj_tracker_rules DROP CONSTRAINT IF EXISTS tj_tracker_rules_auto_key_check;
ALTER TABLE public.tj_tracker_rules ADD CONSTRAINT tj_tracker_rules_auto_key_check
  CHECK (auto_key = ANY (ARRAY['max_loss_per_trade', 'max_loss_per_day', 'playbook_linked', 'stop_loss_set',
    'thesis_written', 'risk_per_trade', 'risk_matched_intent', 'flat_by_close', 'no_entry_in_red_window',
    'no_entry_after_daily_target']));

-- Every book with tracker rules gets the new one, after its trading rules.
INSERT INTO public.tj_tracker_rules (user_id, text, stage, auto_key, config, is_mandatory, sort_order)
SELECT u.user_id, 'Bez ulaza posle dnevnog cilja profita', 'trade', 'no_entry_after_daily_target', '{}'::jsonb, true,
       COALESCE((SELECT max(r.sort_order) FROM public.tj_tracker_rules r
                  WHERE r.user_id = u.user_id AND r.stage = 'trade' AND r.deleted_at IS NULL), -1) + 1
  FROM (SELECT DISTINCT user_id FROM public.tj_tracker_rules) u
 WHERE NOT EXISTS (
   SELECT 1 FROM public.tj_tracker_rules x
    WHERE x.user_id = u.user_id AND x.auto_key = 'no_entry_after_daily_target' AND x.deleted_at IS NULL
 );

-- Note templates already written from the old seed: the same lines, without the count.
UPDATE public.tj_note_folders
   SET template_text = replace(template_text, E'- DLL ostatak:\n- Max trejdova danas:\n',
                               E'- Dnevni limit gubitka, ostatak:\n- Dnevni cilj profita:\n')
 WHERE position('Max trejdova danas' in template_text) > 0;
UPDATE public.tj_note_folders
   SET template_text = replace(template_text, '### Da li sam stao na vreme (DLL, 2 gubitka, dnevni cilj)',
                               '### Da li sam stao na vreme (dnevni limit gubitka, dnevni cilj)')
 WHERE position('2 gubitka, dnevni cilj' in template_text) > 0;

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
  select target, v.text, v.stage, v.auto_key, v.config::jsonb, v.mandatory, v.ord
  from (values
    -- Priprema: pre otvaranja.
    ('Provera kalendara i HTF-a: Proveravam crvene vesti i markiram HTF nivoe likvidnosti pre gledanja manjih tajmfrejmova.', 'prepare', null, '{}', true,  0),
    ('Mentalni check-in: Platformu palim samo ako sam odmoran, smiren i nemam nikakvih distrakcija oko sebe.',             'prepare', null, '{}', false, 1),
    -- Trgovanje: ručna.
    ('Vreme trgovanja: Pozicije otvaram isključivo unutar mojih definisanih vremenskih okvira.',                            'trade',   null, '{}', false, 2),
    ('Kontrola rizika: Rizik po trejdu je strogo kontrolisan i Stop Loss se postavlja momentalno.',                          'trade',   null, '{}', false, 3),
    ('Walk Away Target: Ako ostvarim svoj dnevni cilj u dolarima, zatvaram čartove i ne vraćam profit marketu.',              'trade',   null, '{}', false, 4),
    -- Trgovanje: automatska, iz podataka.
    ('Svaki trejd vezan za playbook',                 'trade', 'playbook_linked',        '{}',             true,  5),
    ('Svaki trejd ima unet stop loss',                'trade', 'stop_loss_set',          '{}',             true,  6),
    ('Svaki trejd ima tezu napisanu pre ulaza',       'trade', 'thesis_written',         '{}',             true,  7),
    ('Net max gubitak po trejdu',                     'trade', 'max_loss_per_trade',     '{}',             true,  8),
    ('Net max gubitak po danu',                       'trade', 'max_loss_per_day',       '{}',             true,  9),
    ('Rizik na ulazu u okviru budžeta',               'trade', 'risk_per_trade',         '{}',             true, 10),
    ('Broj ugovora po budžetu rizika',                'trade', 'risk_matched_intent',    '{}',             true, 11),
    ('Ravno do kraja Topstep dana',                   'trade', 'flat_by_close',          '{}',             true, 12),
    ('Bez ulaza u crvenom prozoru vesti (brief)',     'trade', 'no_entry_in_red_window', '{}',             true, 13),
    ('Bez ulaza posle dnevnog cilja profita',         'trade', 'no_entry_after_daily_target', '{}',        true, 14),
    -- Osvrt: posle sesije.
    ('Dnevnik i tagovi: Unosim svaki trejd u aplikaciju i popunjavam sve tagove (smer, greške, emocije, razlog izlaska).', 'reflect', null, '{}', false, 15),
    ('Screenshotovi: Čuvam sliku čarta za svaki uzet trejd (sa vidljivim ulazom, izlazom i strukturom).',                 'reflect', null, '{}', false, 16)
  ) as v(text, stage, auto_key, config, mandatory, ord);
end;
$function$;

CREATE OR REPLACE FUNCTION public.tj_seed_note_folders(target uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if exists (select 1 from public.tj_note_folders where user_id = target) then
    return;
  end if;

  insert into public.tj_note_folders (user_id, name, sort_order, template_text, is_system)
  values
    (target, 'Plan sesije', 0,
E'## Plan sesije\n\n### Brief i vesti\n- Crveni prozori:\n- Bias dana:\n\n### Nivoi (HTF likvidnost)\n- Iznad:\n- Ispod:\n\n### Scenariji\n- Long ako:\n- Short ako:\n\n### Rizik\n- Budžet po trejdu:\n- Dnevni limit gubitka, ostatak:\n- Dnevni cilj profita:\n', false),
    (target, 'Osvrt na sesiju', 1,
E'## Osvrt na sesiju\n\n### Brojevi\n- Neto P&L:\n- Trejdova:\n- Pravila ispoštovana:\n\n### Šta je radilo\n\n### Šta nije radilo\n\n### Da li sam stao na vreme (dnevni limit gubitka, dnevni cilj)\n\n### Jedna stvar za sutra\n', false),
    (target, 'Trade Notes', 2,
E'## Trejd\n\n### Zašto sam ušao\n\n### Šta je tržište uradilo\n\n### Šta bih uradio drugačije\n', true),
    (target, 'Nedeljni osvrt', 3,
E'## Nedelja\n\n### Brojevi\n- Neto P&L:\n- Trejdova / trading dana:\n- Doslednost procesa:\n- Najbolji i najgori sesijski prozor:\n\n### Šta je radilo\n\n### Šta nije radilo\n\n### Jedan obrazac koji vidim\n\n### Jedna stvar koju menjam sledeće nedelje\n', false);
end;
$function$;
