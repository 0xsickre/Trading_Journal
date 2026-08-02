-- Brisanje tj_positions.result.
--
-- `result` je bio ručni Win / Loss / Breakeven padajući meni na tabu izvršenja.
-- Nijedna statistika ga nikad nije pročitala: svaki win rate, profit factor,
-- streak, breakeven brojač i „Ishod" dimenzija idu kroz `classifyOutcome(pnl,
-- range)`, koji ishod IZVODI iz neto P&L-a i breakeven pojasa naloga. Polje je
-- stajalo pored te računice, nikad u njoj.
--
-- Zato je smetalo, a ne samo bilo suvišno:
--
--   1. Moglo je da laže i niko ne bi primetio. Upišeš „Win" na trejdu koji je
--      posle komisija završio na -3.20 i dnevnik kaže „Win" na jednom mestu a
--      gubitak na svakom drugom. Nijedan izveštaj ne bi prijavio neslaganje
--      jer nijedan izveštaj to polje ne čita.
--   2. Breakeven pojas se podešava po nalogu i sme da se promeni. Izvedeni
--      ishod se tada preračuna kroz celu istoriju; ručno upisan ostaje na
--      staroj klasifikaciji zauvek.
--   3. Bio je jedini unos u formi koji baza već zna — posao koji se traži od
--      korisnika a ne dodaje nijedan podatak.
--
-- Zamena postoji i starija je od ovog brisanja: dimenzija `outcome` („Ishod")
-- u izveštajima, i isti taj izvedeni filter koji sada stoji u Journal gridu.
--
-- `exit_reason` OSTAJE i namerno se ne dira: „Target hit" nasuprot „Stop hit"
-- nasuprot „Time stop" je podatak koji cena ne nosi — to je razlog izlaska, ne
-- ishod, i njega zaista može reći samo trejder.
--
-- Provereno pre pisanja: nijedan red nije imao vrednost.

-- View mora prvi jer nosi p.result kroz sve CTE-ove i u završni SELECT. Nijedan
-- potrošač ga nije čitao — `PositionStat` tip ga nema, a ni njegov TS blizanac
-- `position-stats.ts` — pa je putovao kroz view kao mrtav teret.
--
-- DROP pa CREATE, ne CREATE OR REPLACE: replace ne sme da ukloni kolonu.
DROP VIEW IF EXISTS public.tj_position_stats;

ALTER TABLE public.tj_positions DROP COLUMN result;

CREATE VIEW public.tj_position_stats AS
WITH ex AS (
  SELECT
    e.position_id,
    sum(e.qty)            FILTER (WHERE e.side = 'entry') AS entry_qty,
    sum(e.price * e.qty)  FILTER (WHERE e.side = 'entry') AS entry_notional,
    sum(e.qty)            FILTER (WHERE e.side = 'exit')  AS exit_qty,
    sum(e.price * e.qty)  FILTER (WHERE e.side = 'exit')  AS exit_notional,
    sum(COALESCE(e.fee, 0::numeric))          AS total_fees,
    sum(COALESCE(e.swap_funding, 0::numeric)) AS total_swap,
    min(e.executed_at) FILTER (WHERE e.side = 'entry') AS opened_at,
    max(e.executed_at) FILTER (WHERE e.side = 'exit')  AS closed_at
  FROM public.tj_executions e
  GROUP BY e.position_id
),
base AS (
  SELECT
    p.id AS position_id,
    p.user_id,
    p.account_id,
    p.instrument,
    p.direction,
    p.status,
    p.entry_price,
    p.stop_price,
    ex.entry_qty,
    ex.exit_qty,
    ex.entry_notional,
    ex.exit_notional,
    COALESCE(ex.total_fees, 0::numeric) AS total_fees,
    COALESCE(ex.total_swap, 0::numeric) AS total_swap,
    ex.opened_at,
    ex.closed_at,
    CASE
      WHEN lower(COALESCE(p.direction, ''::text)) LIKE 'short%' THEN -1
      ELSE 1
    END AS dir_mult,
    -- Snapshot first, live instrument only as a fallback for rows written before
    -- the snapshot column existed. No literal default: see 20260728120000.
    COALESCE(p.point_value_at_trade, i.point_value) AS point_value,
    COALESCE(p.tick_size_at_trade,   i.tick_size)   AS tick_size,
    CASE
      WHEN p.point_value_at_trade IS NOT NULL THEN 'snapshot'
      WHEN i.point_value          IS NOT NULL THEN 'instrument'
      ELSE 'missing'
    END AS point_value_source
  FROM public.tj_positions p
  LEFT JOIN ex ON ex.position_id = p.id
  LEFT JOIN public.tj_instruments i
         ON i.user_id = p.user_id AND i.symbol = p.instrument
),
derived AS (
  SELECT
    b.*,
    CASE WHEN b.entry_qty > 0::numeric THEN b.entry_notional / b.entry_qty END AS avg_entry,
    CASE WHEN b.exit_qty  > 0::numeric THEN b.exit_notional  / b.exit_qty  END AS avg_exit,
    -- Realized move on the quantity actually closed, valued against the average
    -- entry — correct for partial exits and for scale-ins alike.
    CASE
      WHEN b.entry_qty > 0::numeric AND b.exit_qty > 0::numeric
        THEN (b.exit_notional - b.entry_notional / b.entry_qty * b.exit_qty)
             * b.dir_mult::numeric
    END AS gross_points
  FROM base b
),
risk AS (
  SELECT
    d.*,
    -- Planned stop distance: plan entry when present, average fill otherwise.
    -- NULLIF collapses a zero-width stop to NULL so R is undefined, not infinite.
    NULLIF(abs(COALESCE(d.entry_price, d.avg_entry) - d.stop_price), 0::numeric) AS risk_pts
  FROM derived d
)
SELECT
  r.position_id,
  r.user_id,
  r.account_id,
  r.instrument,
  r.direction,
  r.status,
  r.entry_qty,
  r.exit_qty,
  r.avg_entry,
  r.avg_exit,
  r.total_fees,
  r.total_swap,
  r.opened_at,
  r.closed_at,
  CASE
    WHEN r.closed_at IS NOT NULL AND r.opened_at IS NOT NULL
      THEN EXTRACT(epoch FROM r.closed_at - r.opened_at)
  END AS duration_seconds,
  r.point_value,
  r.tick_size,
  r.point_value_source,
  r.dir_mult,
  r.gross_points,
  r.gross_points * r.point_value AS gross_pl,
  r.gross_points * r.point_value - r.total_fees - r.total_swap AS net_pl,
  -- R is a price-space ratio, so it survives a missing point value.
  r.gross_points / (r.risk_pts * r.entry_qty) AS realized_r,
  (r.gross_points * r.point_value - r.total_fees - r.total_swap)
    / (r.risk_pts * r.entry_qty * r.point_value) AS realized_r_net
FROM risk r;

-- Run with the QUERYING user's privileges so RLS on tj_positions / tj_executions /
-- tj_instruments still applies. CREATE VIEW resets view options, so this must be
-- re-asserted after every rebuild (Supabase advisor 0010_security_definer_view).
ALTER VIEW public.tj_position_stats SET (security_invoker = on);

-- Lista opcija ostaje bez polja koje je punila. Stavke odlaze kaskadno preko
-- tj_option_items.list_id ON DELETE CASCADE.
DELETE FROM public.tj_option_lists WHERE key = 'result';

-- Isti raspored za sledećeg korisnika. Bez ovoga bi novi nalog dobio listu
-- „Result" koju nijedno polje u formi ne koristi.
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

    insert into public.tj_option_items (user_id, list_id, value, sort_order)
    select target, l.id, v.value, v.ord
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
    insert into public.tj_field_defs (user_id, key, label, field_type, list_key, group_id, sort_order)
    select target, v.key, v.label, 'select', v.key, v.group_id, v.ord
    from (values
      -- Kontekst: smer i kvalitet backdrop-a, sve troje iz vault-a.
      ('macro_align','Macro Align','macro',0),
      ('cot_filter','COT Filter','macro',1),
      ('htf_bias','HTF Bias','macro',2),
      -- Setup: čime si okinuo i na kom timeframe-u.
      ('entry_tf','Entry TF','setup',0)
    ) as v(key, label, group_id, ord)
    on conflict (user_id, key) do nothing;
  end if;

  perform public.tj_seed_instruments_defaults(target);
  perform public.tj_seed_playbooks(target);
  perform public.tj_seed_tracker_rules(target);
  perform public.tj_seed_note_folders(target);
end;
$function$;
