-- Faza G (27.10.2026): put do profesionalca — stanje pre sesije, „sutra menjam“, prilike dana, prvih 10 minuta.
--
-- ZAŠTO. Trejder je uporedio journal sa `trading-transkripti/PUT-DO-PROFESIONALCA.md` i Lance-ovim dnevnim
-- izveštajem (transkript 032) i odlučio (27.10.2026):
--   * mentalna ocena 1–5 odlazi; pre sesije se upisuju kvalitet sna (0–100 %), sati sna, smena (prva / druga /
--     slobodan) i da li je dan sa detetom — „da se zna kad sam radio, da li sam bio slobodan i da li sam dobro
--     spavao“;
--   * na zatvaranju dana jedno polje „sutra menjam“ (naučeno + izmena uz rešenje) i do 3 prilike dana (Lance i
--     Shark, 027; jedna označena kao najlakša, „easiest 50k“, 032) umesto Propuštenog setupa;
--   * novo pravilo: bez ulaza u prvih 10 minuta posle otvaranja Londona i NY;
--   * NY prozor 14:30–17:30 po Beogradu (do ručka) od 28.10.2026.
--
-- ŠTA.
--   * `tj_daily_reports`: `sleep_quality_pct`, `sleep_hours`, `work_shift`, `with_child`, `state_at` (trenutak
--     upisa stanja, okidač kao za `mental_temp_at`), `tomorrow_change`, `opportunities` (jsonb niz, najviše 3).
--     `mental_temp` i `mental_temp_at` ostaju kao istorija; forma ih više ne traži.
--   * CHECK `auto_key` dobija `no_entry_first_minutes`; red za svakog korisnika sa pravilima (važi od danas,
--     prošli dani ostaju kakvi su); fabrička lista pravila sa njim.
--   * `trading_window`: prozor od 2026-10-28, 14:30–17:30 (London od 12.10. ostaje u istoriji).
--   Zaključani dani zadržavaju zamrznute ocene. Ništa se ne briše.

ALTER TABLE public.tj_daily_reports
  ADD COLUMN IF NOT EXISTS sleep_quality_pct smallint
    CHECK (sleep_quality_pct IS NULL OR sleep_quality_pct BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS sleep_hours numeric(3,1)
    CHECK (sleep_hours IS NULL OR sleep_hours BETWEEN 0 AND 24),
  ADD COLUMN IF NOT EXISTS work_shift text
    CHECK (work_shift IS NULL OR work_shift IN ('prva', 'druga', 'slobodan')),
  ADD COLUMN IF NOT EXISTS with_child boolean,
  ADD COLUMN IF NOT EXISTS state_at timestamptz,
  ADD COLUMN IF NOT EXISTS tomorrow_change text,
  ADD COLUMN IF NOT EXISTS opportunities jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(opportunities) = 'array' AND jsonb_array_length(opportunities) <= 3);

COMMENT ON COLUMN public.tj_daily_reports.sleep_quality_pct IS 'Sleep quality 0–100 %, before the session (phase G).';
COMMENT ON COLUMN public.tj_daily_reports.sleep_hours IS 'Hours slept (phase G).';
COMMENT ON COLUMN public.tj_daily_reports.work_shift IS 'prva / druga / slobodan — the day job that day (phase G).';
COMMENT ON COLUMN public.tj_daily_reports.with_child IS 'The day with the child (phase G).';
COMMENT ON COLUMN public.tj_daily_reports.state_at IS 'When the state (sleep, shift, child) was last written; NULL = never (phase G).';
COMMENT ON COLUMN public.tj_daily_reports.tomorrow_change IS 'What I learned and change tomorrow, with the fix (phase G).';
COMMENT ON COLUMN public.tj_daily_reports.opportunities IS
  'Up to 3 opportunities of the day: {note, in_playbook, could_take, easiest} (phase G).';

CREATE OR REPLACE FUNCTION public.tj_daily_report_state_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  IF TG_OP = 'INSERT'
     OR NEW.sleep_quality_pct IS DISTINCT FROM OLD.sleep_quality_pct
     OR NEW.sleep_hours IS DISTINCT FROM OLD.sleep_hours
     OR NEW.work_shift IS DISTINCT FROM OLD.work_shift
     OR NEW.with_child IS DISTINCT FROM OLD.with_child THEN
    NEW.state_at := CASE
      WHEN NEW.sleep_quality_pct IS NULL AND NEW.sleep_hours IS NULL AND NEW.work_shift IS NULL AND NEW.with_child IS NULL
        THEN NULL
      ELSE now()
    END;
  ELSE
    NEW.state_at := OLD.state_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tj_daily_reports_state_at ON public.tj_daily_reports;
CREATE TRIGGER tj_daily_reports_state_at
  BEFORE INSERT OR UPDATE ON public.tj_daily_reports
  FOR EACH ROW EXECUTE FUNCTION public.tj_daily_report_state_at();

ALTER TABLE public.tj_tracker_rules DROP CONSTRAINT IF EXISTS tj_tracker_rules_auto_key_check;
ALTER TABLE public.tj_tracker_rules ADD CONSTRAINT tj_tracker_rules_auto_key_check
  CHECK (auto_key = ANY (ARRAY['max_loss_per_trade', 'max_loss_per_day', 'playbook_linked', 'stop_loss_set',
    'thesis_written', 'risk_per_trade', 'risk_matched_intent', 'flat_by_close', 'no_entry_in_red_window',
    'no_entry_after_daily_target', 'stop_after_two_losses',
    'htf_bias_set', 'thesis_recorded', 'honest_tags', 'review_complete', 'screenshot_per_trade',
    'trading_window', 'daily_psychology', 'no_entry_first_minutes']));

INSERT INTO public.tj_tracker_rules (user_id, text, stage, auto_key, config, is_mandatory, sort_order, active_days)
SELECT u.user_id,
       'Bez ulaza u prvih 10 minuta posle otvaranja (London 09:00, NY 15:30 po Beogradu).',
       'trade',
       'no_entry_first_minutes',
       '{}'::jsonb,
       true,
       COALESCE((SELECT max(r.sort_order) FROM public.tj_tracker_rules r
                  WHERE r.user_id = u.user_id AND r.stage = 'trade' AND r.deleted_at IS NULL), -1) + 1,
       ARRAY[1, 2, 3, 4, 5]
  FROM (SELECT DISTINCT user_id FROM public.tj_tracker_rules WHERE deleted_at IS NULL) u
 WHERE NOT EXISTS (
   SELECT 1 FROM public.tj_tracker_rules x
    WHERE x.user_id = u.user_id AND x.auto_key = 'no_entry_first_minutes' AND x.deleted_at IS NULL
 );

UPDATE public.tj_tracker_rules
   SET config = jsonb_set(
         COALESCE(config, '{}'::jsonb),
         '{windows}',
         COALESCE(config->'windows', '[]'::jsonb) || '[{"since": "2026-10-28", "from": "14:30", "to": "17:30"}]'::jsonb)
 WHERE auto_key = 'trading_window'
   AND deleted_at IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM jsonb_array_elements(COALESCE(config->'windows', '[]'::jsonb)) w
      WHERE w->>'since' = '2026-10-28'
   );

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
    ('Dva SL zaredom = kraj dana (dobitak ili scratch između prekida niz)', 'trade', 'stop_after_two_losses', '{}', true, 8),
    ('Bez ulaza u prvih 10 minuta posle otvaranja (London 09:00, NY 15:30 po Beogradu).', 'trade', 'no_entry_first_minutes', '{}', true, 9),
    -- Osvrt: posle sesije.
    ('Dnevnik i tagovi: Unosim svaki trejd u aplikaciju i popunjavam sve tagove (smer, greške, emocije, razlog izlaska).', 'reflect', null, '{}', false, 10),
    ('Screenshotovi: Čuvam sliku čarta za svaki uzet trejd (sa vidljivim ulazom, izlazom i strukturom).',                 'reflect', null, '{}', false, 11),
    ('Psihologija dana: na /daily upisano kako sam se osećao (dan sa trejdom).',                                           'reflect', 'daily_psychology', '{}', true, 12)
  ) as v(text, stage, auto_key, config, mandatory, ord);
end;
$function$;
