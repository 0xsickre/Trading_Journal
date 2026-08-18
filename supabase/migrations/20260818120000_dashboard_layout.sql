-- Dashboard layout: what is on the page, and saved arrangements of it.
--
-- Written alongside the widget picker, which shipped one commit earlier storing
-- its choice in localStorage. That is per BROWSER — the exact complaint
-- `20260801150000_user_prefs.sql` was created to answer — and this is the
-- upgrade path off it.
--
-- TWO STORES, BECAUSE THERE ARE TWO DIFFERENT THINGS HERE.
--
--   - What the dashboard looks like RIGHT NOW is one value per user. That is a
--     preference, and `tj_user_prefs` exists to hold exactly one of those per
--     user. It gets columns, precisely as that migration predicted the next
--     preference would: "when a second preference is needed it gets a second
--     column".
--   - A NAMED arrangement the user can have several of and switch between has
--     an identity and a name. That is an entity, and it gets a table.
--
-- Neither is jsonb. `tj_user_prefs` refuses a `prefs` bag because a value that
-- decides what code does must not sit where a typo is invisible until someone
-- reads the rendered page. A list of widget ids IS a list of ids, and `text[]`
-- says so.

-- The live layout ----------------------------------------------------------

ALTER TABLE public.tj_user_prefs
  ADD COLUMN dashboard_hidden_widgets text[] NOT NULL DEFAULT '{}'
    CHECK (array_length(dashboard_hidden_widgets, 1) IS NULL
           OR array_length(dashboard_hidden_widgets, 1) <= 100);

COMMENT ON COLUMN public.tj_user_prefs.dashboard_hidden_widgets IS
  'Widget ids switched OFF, mirroring journal_hidden_columns. Hidden and not '
  'visible so a widget added in a later release appears for the users who have '
  'already configured their dashboard, rather than staying invisible to '
  'exactly them. Unknown ids are inert; resolution lives in '
  'lib/journal/dashboard-widgets.ts, which also refuses to hide the three '
  'locked sections however this array was written.';

-- Named arrangements -------------------------------------------------------

CREATE TABLE public.tj_dashboard_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  name text NOT NULL CHECK (btrim(name) <> '' AND length(name) <= 60),

  /*
   * The widgets this template shows, in order.
   *
   * VISIBLE here, HIDDEN in the column above — and the asymmetry is deliberate
   * rather than an oversight.
   *
   * The live layout stores hidden so that a widget shipped next month shows up
   * unasked. A template is a different promise: the user named an arrangement,
   * and a section appearing in it because there was a release is not the
   * arrangement they saved. Storing the visible set freezes it, and freezing it
   * is what "save this layout" meant.
   *
   * Ids the registry no longer knows are skipped rather than rendered, the same
   * way a stale column id is — which is what stops a renamed widget from
   * blanking a saved template.
   */
  widgets text[] NOT NULL
    CHECK (array_length(widgets, 1) IS NOT NULL
           AND array_length(widgets, 1) <= 100),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Two templates called "Swing" are two things the dropdown cannot tell apart.
  UNIQUE (user_id, name)
);

-- An empty template is a blank page wearing a name, and the CHECK above refuses
-- it in the schema rather than in a form — Postgres reports NULL, not 0, for an
-- empty array's length, which is why the test reads `IS NOT NULL`.

COMMENT ON TABLE public.tj_dashboard_templates IS
  'Named dashboard arrangements. `widgets` is the visible set IN ORDER, '
  'resolved against the registry in lib/journal/dashboard-widgets.ts.';

CREATE INDEX tj_dashboard_templates_user_name_idx
  ON public.tj_dashboard_templates (user_id, name);

ALTER TABLE public.tj_dashboard_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY tj_dashboard_templates_owner ON public.tj_dashboard_templates
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE TRIGGER tj_dashboard_templates_updated_at
  BEFORE UPDATE ON public.tj_dashboard_templates
  FOR EACH ROW EXECUTE FUNCTION public.tj_set_updated_at();

-- Which arrangement is selected --------------------------------------------

ALTER TABLE public.tj_user_prefs
  -- NULL is the normal state: the ad-hoc layout in `dashboard_hidden_widgets`.
  -- ON DELETE SET NULL rather than CASCADE — deleting a template must drop the
  -- selection, never the row holding every other preference the user has.
  ADD COLUMN dashboard_template_id uuid
    REFERENCES public.tj_dashboard_templates(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.tj_user_prefs.dashboard_template_id IS
  'Selected named template, or NULL for the ad-hoc layout in '
  'dashboard_hidden_widgets. Deleting the template clears this rather than the '
  'preferences row.';
