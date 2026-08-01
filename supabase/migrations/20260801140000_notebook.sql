-- Faza 6 — Notebook.
--
-- Long-form writing, separate from /daily. The process journal is a structured
-- form with fixed questions; this is where the weekly review, a market
-- observation, or a paragraph about one trade goes. They are not the same thing
-- and the daily report is deliberately not touched.
--
-- Content is MARKDOWN, stored as plain text. Rendering happens in TypeScript
-- into React elements, never into an HTML string, so a note can never inject
-- markup — and the stored text stays greppable, diffable and exportable, which
-- an HTML blob from a WYSIWYG editor would not be.

-- 1) Folders ------------------------------------------------------------------
--
-- Hard-deletable, with tj_notes.folder_id ON DELETE SET NULL. The alternative —
-- soft-deleting folders, or refusing to delete a folder holding notes — either
-- hides notes behind an invisible parent or forces the user to empty a folder by
-- hand. A note that outlives its folder shows up under "no folder" and is one
-- click from being refiled; nothing is ever lost.

CREATE TABLE public.tj_note_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  name text NOT NULL CHECK (btrim(name) <> ''),

  -- Pre-filled into a new note's body. The point of a weekly review is that the
  -- questions are already there when you sit down; a blank page asks nothing.
  template_text text,

  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id, name)
);

CREATE INDEX tj_note_folders_user_idx ON public.tj_note_folders (user_id, sort_order, id);

-- 2) Notes --------------------------------------------------------------------

CREATE TABLE public.tj_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  folder_id uuid REFERENCES public.tj_note_folders(id) ON DELETE SET NULL,

  title text NOT NULL DEFAULT '' ,
  content text NOT NULL DEFAULT '',

  -- Optional anchors. Both SET NULL rather than CASCADE: a note about a trade
  -- you later deleted is still a lesson you wrote, and deleting the trade must
  -- not delete the thinking about it.
  position_id uuid REFERENCES public.tj_positions(id) ON DELETE SET NULL,
  report_date date,

  -- Own vocabulary, deliberately not tj_option_items. Note tags describe what a
  -- piece of writing is about; option items describe a trade. Sharing one list
  -- would put "FOMO" and "Weekly review" in the same dropdown.
  tags text[] NOT NULL DEFAULT '{}',

  pinned boolean NOT NULL DEFAULT false,

  -- "Recently Deleted" is this column, not a folder. A folder would have to be
  -- moved INTO on delete, which forgets where the note came from and leaves
  -- restore with nowhere to put it back.
  deleted_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Every FK gets an index, per the audit in 20260729091418_integrity_guards:
-- without them the ON DELETE actions do a sequential scan of the whole table.
CREATE INDEX tj_notes_user_idx ON public.tj_notes (user_id, id);
CREATE INDEX tj_notes_folder_idx ON public.tj_notes (folder_id);
CREATE INDEX tj_notes_position_idx ON public.tj_notes (position_id);
-- The list view's default sort, filtered to live notes.
CREATE INDEX tj_notes_live_idx
  ON public.tj_notes (user_id, updated_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX tj_notes_tags_idx ON public.tj_notes USING gin (tags);

-- 3) Tag vocabulary -----------------------------------------------------------

CREATE TABLE public.tj_note_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (btrim(name) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE INDEX tj_note_tags_user_idx ON public.tj_note_tags (user_id, name);

-- 4) RLS + updated_at ---------------------------------------------------------

ALTER TABLE public.tj_note_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tj_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tj_note_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY tj_note_folders_owner ON public.tj_note_folders
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY tj_notes_owner ON public.tj_notes
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY tj_note_tags_owner ON public.tj_note_tags
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE TRIGGER tj_note_folders_updated_at
  BEFORE UPDATE ON public.tj_note_folders
  FOR EACH ROW EXECUTE FUNCTION public.tj_set_updated_at();

CREATE TRIGGER tj_notes_updated_at
  BEFORE UPDATE ON public.tj_notes
  FOR EACH ROW EXECUTE FUNCTION public.tj_set_updated_at();

-- 5) Seed ---------------------------------------------------------------------
--
-- Folders and their templates are seeded; NOTES are not. Same reasoning that
-- kept the playbook free of seeded rules: a template is a question waiting to be
-- answered, while a seeded note is someone else's answer sitting in your journal.

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

  insert into public.tj_note_folders (user_id, name, sort_order, template_text)
  values
    (target, 'Weekly Review', 0,
E'## Nedelja\n\n### Brojevi\n- Neto P&L:\n- Broj trejdova:\n- Doslednost procesa:\n\n### Šta je radilo\n\n### Šta nije radilo\n\n### Jedan obrazac koji vidim\n\n### Jedna stvar koju menjam sledeće nedelje\n'),
    (target, 'Trade Notes', 1,
E'## Trejd\n\n### Zašto sam ušao\n\n### Šta je tržište uradilo\n\n### Šta bih uradio drugačije\n'),
    (target, 'Market Observations', 2,
E'## Zapažanje\n\n### Šta vidim\n\n### Zašto je važno\n\n### Šta bi ga poništilo\n');
end;
$function$;

-- SECURITY DEFINER taking a user id must not be reachable over /rest/v1/rpc —
-- the exact hole 20260729140000 had to close.
REVOKE ALL ON FUNCTION public.tj_seed_note_folders(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tj_seed_note_folders(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.tj_seed_note_folders(uuid) FROM authenticated;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM auth.users LOOP
    PERFORM public.tj_seed_note_folders(r.id);
  END LOOP;
END $$;

-- 6) Fold into the signup seed. Only the last line changes. --------------------

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
      ('result','Result','Risk',8),
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
      ('result','Win',0),('result','Loss',1),('result','Breakeven',2),
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
      ('macro_align','Macro Align','macro',0),
      ('cot_filter','COT Filter','macro',1),
      ('htf_bias','HTF Bias','setup',0),
      ('entry_tf','Entry TF','plan_advanced',0)
    ) as v(key, label, group_id, ord)
    on conflict (user_id, key) do nothing;
  end if;

  perform public.tj_seed_instruments_defaults(target);
  perform public.tj_seed_playbooks(target);
  perform public.tj_seed_tracker_rules(target);
  perform public.tj_seed_note_folders(target);
end;
$function$;
