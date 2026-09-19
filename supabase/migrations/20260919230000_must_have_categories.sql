-- Must-have categories and tags: the defaults a new user, and a reset, start with.
--
-- WHAT CHANGED, AND WHY. Every category left is one a report can answer a
-- question with, and every tag in it means one thing:
--
--   * Macro Align and COT Filter — gone from the defaults; the trader had
--     already deleted both, and HTF Bias carries the direction call.
--   * Entry TF — 15m, 1h, 4h, 1D: the owner trades swing, so 1m and 5m entries
--     are not a thing to pick from.
--   * Technical tags — one name per concept: MSS replaces BOS and CHoCH (the
--     same break, two names), FVG replaces Imbalance (a synonym), Equal
--     highs/lows is the liquidity a sweep takes, not a separate setup. Added
--     iFVG and SMT divergence; kept the trader's own HTF rejection close.
--   * Exit reason — mutually exclusive, and silent about profit or loss (the
--     P&L already says that): Target hit, Stop hit, Breakeven, Trailing stop,
--     Closed early, Time exit.
--   * Miss reason — why a valid setup was not taken; "Skipped by rules" is a
--     GOOD skip, kept so the filters can be seen paying for themselves. "Other"
--     is gone: a new tag can be typed.
--   * Emotion — states only. Discipline — what went RIGHT. Mistake — what went
--     wrong. Before, "Revenge", "Moved stop", "Cut winner short" and
--     "Oversized" sat in two of these at once, so one act was counted in two
--     tables. "No mistake" stays: it tells a reviewed clean trade from one
--     never reviewed. "Overmanaged" is the swing trader's own error: a
--     higher-timeframe idea managed on the lower timeframe.
--   * Risk % — 0.25 / 0.5 / 0.75 / 1. On a prop account with a 5 % daily
--     limit, 2 % a trade is two losses from the edge.
--
-- Direction and Setup grade are kept exactly: both are hidden from Settings
-- and computed, and history reads their labels.

create or replace function public.tj_seed_categories(target uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if not exists (select 1 from public.tj_option_lists where user_id = target) then
    insert into public.tj_option_lists (user_id, key, label, category, sort_order)
    select target, v.key, v.label, v.category, v.sort_order
    from (values
      ('direction','Direction','Context',0),
      ('htf_bias','HTF Bias','Context',1),
      ('entry_tf','Entry TF','Context',2),
      ('technical_tag','Technical Tags','ICT Setup',3),
      ('setup_grade','Setup Grade','ICT Setup',4),
      ('risk_pct','Risk %','Risk',5),
      ('exit_reason','Exit Reason','Risk',6),
      ('miss_reason','Miss Reason','Risk',7),
      ('emotion','Emotion','Psychology',8),
      ('discipline','Discipline','Psychology',9),
      ('mistake','Mistake','Psychology',10)
    ) as v(key, label, category, sort_order);

    insert into public.tj_option_items (user_id, list_id, value, label, sort_order)
    select target, l.id, v.value, v.value, v.ord
    from (values
      ('direction','Long',0),('direction','Short',1),
      ('htf_bias','Bullish',0),('htf_bias','Bearish',1),('htf_bias','Neutral',2),
      ('entry_tf','15m',0),('entry_tf','1h',1),('entry_tf','4h',2),('entry_tf','1D',3),
      ('technical_tag','Liquidity sweep',0),('technical_tag','MSS',1),('technical_tag','FVG',2),
      ('technical_tag','iFVG',3),('technical_tag','Order block',4),('technical_tag','Breaker',5),
      ('technical_tag','OTE',6),('technical_tag','SMT divergence',7),('technical_tag','HTF rejection close',8),
      ('setup_grade','A+',0),('setup_grade','A',1),('setup_grade','B',2),('setup_grade','C',3),
      ('risk_pct','0.25',0),('risk_pct','0.5',1),('risk_pct','0.75',2),('risk_pct','1',3),
      ('exit_reason','Target hit',0),('exit_reason','Stop hit',1),('exit_reason','Breakeven',2),
      ('exit_reason','Trailing stop',3),('exit_reason','Closed early',4),('exit_reason','Time exit',5),
      ('miss_reason','No fill',0),('miss_reason','Hesitated',1),('miss_reason','Not at screen',2),
      ('miss_reason','Skipped by rules',3),('miss_reason','News / event',4),
      ('emotion','Calm',0),('emotion','FOMO',1),('emotion','Fear',2),('emotion','Revenge',3),
      ('emotion','Impatient',4),('emotion','Overconfident',5),('emotion','Tired',6),
      ('discipline','Followed plan',0),('discipline','Respected risk',1),('discipline','Managed by plan',2),
      ('mistake','No mistake',0),('mistake','Early entry',1),('mistake','Chased price',2),
      ('mistake','Moved stop',3),('mistake','Cut winner early',4),('mistake','Overmanaged',5),
      ('mistake','Oversized',6),('mistake','Against HTF bias',7)
    ) as v(list_key, value, ord)
    join public.tj_option_lists l on l.user_id = target and l.key = v.list_key;

    -- Inside the same guard as the lists: `ensureDefaults` runs this on every
    -- visit to the home page, and a category the trader deleted must not come
    -- back on the next one.
    insert into public.tj_field_defs (user_id, key, label, field_type, list_key, show_phase, sort_order)
    select target, v.key, v.label, v.field_type, v.list_key, v.show_phase, v.ord
    from (values
      ('htf_bias',        'HTF Bias',        'select', 'htf_bias',      'always', 0),
      ('entry_tf',        'Entry TF',        'select', 'entry_tf',      'always', 1),
      ('technical_tags',  'Technical Tags',  'tags',   'technical_tag', 'always', 2),
      ('exit_reason',     'Exit Reason',     'select', 'exit_reason',   'active', 3),
      ('mistake',         'Mistake',         'tags',   'mistake',       'active', 4),
      ('psychology_tags', 'Psychology tags', 'tags',   'emotion',       'active', 5),
      ('miss_reason',     'Miss Reason',     'select', 'miss_reason',   'missed', 6)
    ) as v(key, label, field_type, list_key, show_phase, ord)
    on conflict (user_id, key) do nothing;
  end if;
end;
$function$;

revoke all on function public.tj_seed_categories(uuid) from public, anon, authenticated;

create or replace function public.tj_seed_defaults(target uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if not exists (select 1 from public.tj_accounts where user_id = target) then
    insert into public.tj_accounts (user_id, name, currency, starting_balance, default_asset_class, timezone)
    values (target, 'Main Account', 'USD', 0, 'Futures', 'America/New_York');
  end if;

  perform public.tj_seed_categories(target);
  perform public.tj_seed_instruments_defaults(target);
  perform public.tj_seed_playbooks(target);
  perform public.tj_seed_tracker_rules(target);
  perform public.tj_seed_note_folders(target);
end;
$function$;

-- Existing users with NO trades get the new set now. With no trade holding a
-- tag, replacing the lists loses nothing; a user with even one trade keeps
-- every list as it is, since trades store tags as text.
do $$
declare
  u uuid;
begin
  for u in
    select distinct l.user_id
    from public.tj_option_lists l
    where not exists (select 1 from public.tj_positions p where p.user_id = l.user_id)
  loop
    delete from public.tj_option_lists where user_id = u;  -- items cascade
    delete from public.tj_field_defs where user_id = u and list_key is not null;
    perform public.tj_seed_categories(u);
  end loop;
end
$$;
