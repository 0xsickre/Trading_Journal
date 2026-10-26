-- Faza X1 (26.10.2026): tracker meri samo proces.
--
-- ZAŠTO. Trejder (X-1 B): „Brišu se, tracker meri samo proces … jer ako bude više naloga na prop firma biće
-- konflikta.“ Novčana pravila (dnevni gubitak, gubitak po trejdu, rizik po trejdu, broj ugovora po budžetu, bez
-- ulaza posle dnevnog cilja) čitala su pravila jedne prop firme; novac trejder drži sam, na platformi svakog naloga.
--
-- ŠTA.
--   * Pet novčanih pravila se PENZIONIŠE (`deleted_at`), ne briše. Zaključani dani čuvaju zamrznute ocene koje
--     pokazuju na te redove (`tj_tracker_checkins.rule_id`), pa red mora da ostane. Kod više nema evaluator za
--     te ključeve: otključan prošli dan ih ne boduje, zaključan zadržava ono što je zamrznuo.
--   * `tj_tracker_rules_auto_key_check` se NE sužava: penzionisani redovi i dalje nose svoje ključeve.
--   * „Iskreni tagovi“: „Ispoštovao rizik“ se više ne poredi sa pravilom rizika, samo sa stopom.
--   * Fabrička lista (`tj_seed_tracker_rules`, nova knjiga) bez novčanih pravila i bez ručnog „Walk Away Target“
--     (dnevni cilj u dolarima); „Ravno do kraja dana“ bez imena firme.

UPDATE public.tj_tracker_rules
   SET deleted_at = now()
 WHERE auto_key IN ('max_loss_per_day', 'max_loss_per_trade', 'risk_per_trade', 'risk_matched_intent',
                    'no_entry_after_daily_target')
   AND deleted_at IS NULL;

UPDATE public.tj_tracker_rules
   SET text = replace(text, '„Ispoštovao rizik“ uz pao rizik ili stop', '„Ispoštovao rizik“ bez stopa')
 WHERE auto_key = 'honest_tags'
   AND deleted_at IS NULL
   AND position('„Ispoštovao rizik“ uz pao rizik ili stop' in text) > 0;

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
    -- Trgovanje: automatska, iz podataka.
    ('Svaki trejd vezan za playbook',                 'trade', 'playbook_linked',        '{}',             true,  4),
    ('Svaki trejd ima unet stop loss',                'trade', 'stop_loss_set',          '{}',             true,  5),
    ('Svaki trejd ima tezu napisanu pre ulaza',       'trade', 'thesis_written',         '{}',             true,  6),
    ('Ravno do kraja dana',                           'trade', 'flat_by_close',          '{}',             true,  7),
    ('Bez ulaza u crvenom prozoru vesti (brief)',     'trade', 'no_entry_in_red_window', '{}',             true,  8),
    ('Dva SL zaredom = kraj dana (dobitak ili scratch između prekida niz)', 'trade', 'stop_after_two_losses', '{}', true, 9),
    -- Osvrt: posle sesije.
    ('Dnevnik i tagovi: Unosim svaki trejd u aplikaciju i popunjavam sve tagove (smer, greške, emocije, razlog izlaska).', 'reflect', null, '{}', false, 10),
    ('Screenshotovi: Čuvam sliku čarta za svaki uzet trejd (sa vidljivim ulazom, izlazom i strukturom).',                 'reflect', null, '{}', false, 11)
  ) as v(text, stage, auto_key, config, mandatory, ord);
end;
$function$;
