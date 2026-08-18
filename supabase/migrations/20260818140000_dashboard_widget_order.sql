-- The order the dashboard's sections render in.
--
-- Left out of `20260818120000_dashboard_layout.sql` because that migration
-- shipped alongside a picker that could only switch sections on and off. The
-- page rendered from a fixed sequence in the source file, so there was nothing
-- for a stored order to override. Now it renders from a list, and there is.
--
-- Separate from `dashboard_hidden_widgets` rather than folded into one array,
-- because the two answer different questions and fail differently. Hiding a
-- widget is a statement about that widget alone; ordering is a statement about
-- all of them at once. Storing one array of visible-ids-in-order would have
-- collapsed them — and would have meant a widget added in a release could only
-- appear by being absent from a list whose whole purpose is to be exhaustive.

ALTER TABLE public.tj_user_prefs
  ADD COLUMN dashboard_widget_order text[] NOT NULL DEFAULT '{}'
    CHECK (array_length(dashboard_widget_order, 1) IS NULL
           OR array_length(dashboard_widget_order, 1) <= 100);

COMMENT ON COLUMN public.tj_user_prefs.dashboard_widget_order IS
  'Widget ids top to bottom. EMPTY MEANS THE REGISTRY ORDER, not "no widgets" '
  '— it is the normal state and every account starts there. Unknown ids are '
  'skipped and registry ids missing from the array are appended in registry '
  'order, so neither a widget renamed in a release nor one added in it can '
  'leave the page short a section. Resolution lives in '
  'lib/journal/dashboard-widgets.ts (`resolveOrder`).';
