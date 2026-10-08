-- Two stop losses IN A ROW end the day (trader, 08.10.2026, with the mentor).
--
-- WHY. On 30.09.2026 the count rules went: "the day stops on money, never on a
-- count of trades". That still holds — this is not a count of trades. With a risk
-- of ~$300 a trade and a personal DLL of $650, two full stops leave room for a
-- third entry, and the trader wants the day over after two stops in a row: "2 SL
-- kraj, ali uzastopna — ako jednu dobijem nakon gubitka nije kraj". A win or a
-- scratch inside the breakeven band breaks the run (`stop_after_two_losses` in
-- `tracker/auto-rules.ts`).
--
-- The trader had written it as a manual rule the same morning; the manual one is
-- retired (kept, `deleted_at`) and the scored one takes its place.

ALTER TABLE public.tj_tracker_rules DROP CONSTRAINT IF EXISTS tj_tracker_rules_auto_key_check;
ALTER TABLE public.tj_tracker_rules ADD CONSTRAINT tj_tracker_rules_auto_key_check
  CHECK (auto_key = ANY (ARRAY['max_loss_per_trade', 'max_loss_per_day', 'playbook_linked', 'stop_loss_set',
    'thesis_written', 'risk_per_trade', 'risk_matched_intent', 'flat_by_close', 'no_entry_in_red_window',
    'no_entry_after_daily_target', 'stop_after_two_losses']));

UPDATE public.tj_tracker_rules
   SET deleted_at = now()
 WHERE auto_key IS NULL
   AND deleted_at IS NULL
   AND text LIKE 'Dva SL zaredom%';

INSERT INTO public.tj_tracker_rules (user_id, text, stage, auto_key, config, is_mandatory, sort_order)
SELECT u.user_id, 'Dva SL zaredom = kraj dana (dobitak ili scratch između prekida niz)', 'trade',
       'stop_after_two_losses', '{}'::jsonb, true, 3
  FROM (SELECT DISTINCT user_id FROM public.tj_tracker_rules) u
 WHERE NOT EXISTS (
   SELECT 1 FROM public.tj_tracker_rules x
    WHERE x.user_id = u.user_id AND x.auto_key = 'stop_after_two_losses' AND x.deleted_at IS NULL
 );

-- A new book gets it too: the factory set of 20260930070000 plus this one rule.
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
    ('Dva SL zaredom = kraj dana (dobitak ili scratch između prekida niz)', 'trade', 'stop_after_two_losses', '{}', true, 15),
    -- Osvrt: posle sesije.
    ('Dnevnik i tagovi: Unosim svaki trejd u aplikaciju i popunjavam sve tagove (smer, greške, emocije, razlog izlaska).', 'reflect', null, '{}', false, 16),
    ('Screenshotovi: Čuvam sliku čarta za svaki uzet trejd (sa vidljivim ulazom, izlazom i strukturom).',                 'reflect', null, '{}', false, 17)
  ) as v(text, stage, auto_key, config, mandatory, ord);
end;
$function$;
