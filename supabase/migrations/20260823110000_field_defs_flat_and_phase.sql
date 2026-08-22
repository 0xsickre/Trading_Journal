-- Grupe napuštaju formu; kategorija sama kaže kada se pojavljuje.
--
-- `group_id` je stavljao svako korisničko polje u jednu od četiri grupe fiksirane
-- u kodu — „Setup", „Context", dve „Advanced". Te grupe su nosile naslov i opis
-- koje niko nije mogao ni da preimenuje, ni da obriše, ni da doda svoju: jedina
-- struktura na formi koju je korisnik gledao a nije mogao da dotakne. Na formi
-- ostaje ravan spisak kategorija, u redosledu koji se podešava u Settings.
--
-- `show_phase` je ono što grupa nikad nije umela da kaže: da li se kategorija
-- traži uvek, ili samo dok je trejd planiran, aktivan, odnosno propušten. Do sad
-- se svako novo polje pojavljivalo odmah na planu, bez izbora.

-- 1) Kada se kategorija pojavljuje -------------------------------------------

ALTER TABLE public.tj_field_defs
  ADD COLUMN show_phase text NOT NULL DEFAULT 'always' CHECK (
    show_phase IN ('always', 'planned', 'active', 'missed')
  );

COMMENT ON COLUMN public.tj_field_defs.show_phase IS
  'Faza trejda u kojoj se polje traži: always | planned | active | missed. '
  'Default ''always'' čuva ponašanje kakvo je bilo pre uvođenja kolone.';

-- 2) Redosled postaje globalan ------------------------------------------------
--
-- `sort_order` je bio jedinstven samo unutar grupe, pa su se posle spajanja
-- ordinali iz različitih grupa poklapali i redosled bi zavisio od `id` tiebreak-a.
-- Prenumeracija zadržava raspored koji su grupe podrazumevale — Setup, pa
-- Context, pa Advanced parovi — tako da forma posle migracije izgleda kao pre
-- nje, samo bez naslova.

WITH ordered AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY user_id
      ORDER BY
        CASE group_id
          WHEN 'setup' THEN 0
          WHEN 'macro' THEN 1
          WHEN 'plan_advanced' THEN 2
          ELSE 3
        END,
        sort_order,
        id
    ) - 1 AS ord
  FROM public.tj_field_defs
)
UPDATE public.tj_field_defs d
   SET sort_order = o.ord
  FROM ordered o
 WHERE o.id = d.id;

-- 3) Grupa odlazi -------------------------------------------------------------

DROP INDEX IF EXISTS public.tj_field_defs_user_order_idx;

ALTER TABLE public.tj_field_defs
  DROP COLUMN group_id;

CREATE INDEX tj_field_defs_user_order_idx
  ON public.tj_field_defs (user_id, sort_order, id);

-- 4) Seed bez grupa -----------------------------------------------------------
--
-- Isti raspored za sledećeg korisnika; bez ovoga bi nov nalog dobio ordinale
-- koji se svi zovu 0. Redosled je onaj sa forme: prvo timeframe na kom se
-- izvršava, pa makro čitanje.

CREATE OR REPLACE FUNCTION public.tj_seed_defaults(target uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not exists (select 1 from public.tj_accounts where user_id = target) then
    insert into public.tj_accounts (user_id, name, currency, starting_balance, default_asset_class, timezone)
    values (target, 'Main Account', 'USD', 0, 'Futures', 'America/New_York');
  end if;

  if not exists (select 1 from public.tj_option_lists where user_id = target) then
    insert into public.tj_option_lists (user_id, key, label, category, sort_order)
    select target, v.key, v.label, v.category, v.sort_order
    from (values
      ('direction','Direction','Context',0),
      ('macro_align','Macro Align','Context',1),
      ('cot_filter','COT Filter','Context',2),
      ('htf_bias','HTF Bias','Context',3),
      ('entry_tf','Entry TF','Context',4),
      ('technical_tag','Technical Tags','ICT Setup',5),
      ('setup_grade','Setup Grade','ICT Setup',6),
      ('risk_pct','Risk %','Risk',7),
      ('exit_reason','Exit Reason','Risk',9),
      ('miss_reason','Miss Reason','Risk',10),
      ('emotion','Emotion','Psychology',11),
      ('discipline','Discipline','Psychology',12),
      ('mistake','Mistake','Psychology',13)
    ) as v(key, label, category, sort_order);

    insert into public.tj_option_items (user_id, list_id, value, label, sort_order)
    select target, l.id, v.value, v.value, v.ord
    from (values
      ('direction','Long',0),('direction','Short',1),
      ('macro_align','Aligned',0),('macro_align','Neutral',1),('macro_align','Against',2),
      ('cot_filter','Bullish',0),('cot_filter','Neutral',1),('cot_filter','Bearish',2),
      ('htf_bias','Bullish',0),('htf_bias','Neutral',1),('htf_bias','Bearish',2),
      ('entry_tf','1m',0),('entry_tf','5m',1),('entry_tf','15m',2),('entry_tf','1h',3),('entry_tf','4h',4),('entry_tf','1D',5),
      ('technical_tag','FVG',0),('technical_tag','Order Block',1),('technical_tag','Liquidity Sweep',2),('technical_tag','Breaker',3),('technical_tag','BOS',4),('technical_tag','CHoCH',5),('technical_tag','Imbalance',6),('technical_tag','Equal Highs/Lows',7),
      ('setup_grade','A+',0),('setup_grade','A',1),('setup_grade','B',2),('setup_grade','C',3),
      ('risk_pct','0.25',0),('risk_pct','0.5',1),('risk_pct','1',2),('risk_pct','2',3),
      ('exit_reason','Target hit',0),('exit_reason','Stop hit',1),('exit_reason','Manual',2),('exit_reason','Time stop',3),('exit_reason','Trail',4),
      ('miss_reason','No fill',0),('miss_reason','Price ran away',1),('miss_reason','Setup invalidated',2),('miss_reason','News / event',3),('miss_reason','Discretion',4),('miss_reason','Session ended',5),('miss_reason','Other',6),
      ('emotion','Discipliniran',0),('emotion','FOMO',1),('emotion','Strah',2),('emotion','Pohlepa',3),('emotion','Revenge',4),('emotion','Nestrpljiv',5),('emotion','Overconfident',6),('emotion','Umoran/rastrojen',7),
      ('discipline','Followed plan',0),('discipline','Moved stop',1),('discipline','Cut winner short',2),('discipline','Revenge',3),('discipline','Oversized',4),
      ('mistake','None',0),('mistake','Late entry',1),('mistake','Early/no confirmation',2),('mistake','Moved stop',3),('mistake','Cut winner short',4),('mistake','Oversized',5),('mistake','Chased/FOMO',6),('mistake','Against bias',7)
    ) as v(list_key, value, ord)
    join public.tj_option_lists l on l.user_id = target and l.key = v.list_key;
  end if;

  if not exists (select 1 from public.tj_field_defs where user_id = target) then
    insert into public.tj_field_defs (user_id, key, label, field_type, list_key, sort_order)
    select target, v.key, v.label, 'select', v.key, v.ord
    from (values
      ('entry_tf','Entry TF',0),
      ('macro_align','Macro Align',1),
      ('cot_filter','COT Filter',2),
      ('htf_bias','HTF Bias',3)
    ) as v(key, label, ord)
    on conflict (user_id, key) do nothing;
  end if;

  perform public.tj_seed_instruments_defaults(target);
  perform public.tj_seed_playbooks(target);
  perform public.tj_seed_tracker_rules(target);
  perform public.tj_seed_note_folders(target);
end;
$function$;
