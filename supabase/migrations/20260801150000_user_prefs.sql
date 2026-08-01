-- Per-user UI preferences.
--
-- Nothing of the sort existed: the only persistence in the app was
-- `trade-form-prefs.ts` in localStorage, which is per BROWSER — open the journal
-- on a phone and your column choices are gone. This is the first per-user store.
--
-- A narrow typed table rather than a `prefs jsonb` bag, for the same reason
-- `auto_key` is a column and not a key inside `config`: a value that decides
-- what code does must not live in a free-form blob where a typo is invisible
-- until someone reads the rendered page. When a second preference is needed it
-- gets a second column.

CREATE TABLE public.tj_user_prefs (
  -- One row per user, so the primary key IS the user. No separate id: there is
  -- nothing to have two of.
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  /*
   * Journal grid columns the user has switched OFF.
   *
   * Hidden rather than visible, and the difference matters more than it looks:
   *
   *   - storing HIDDEN means a column added to the grid next month is visible to
   *     everyone immediately. Anything not named here shows.
   *   - storing VISIBLE would freeze each user's list at the day they last
   *     touched it, so every future column would ship invisible to exactly the
   *     users who already care enough to have configured the grid.
   *
   * It also makes the array inert under change: an id left behind by a renamed
   * or deleted column matches nothing and quietly stops mattering, instead of
   * blanking the grid. Empty means the default — everything visible.
   *
   * Deliberately NOT constrained to a list of known ids: the ids live in the
   * grid component, and a CHECK here would have to be migrated in lockstep with
   * every column added. The cost of that coupling is higher than the cost of an
   * ignored string.
   */
  journal_hidden_columns text[] NOT NULL DEFAULT '{}'
    CHECK (array_length(journal_hidden_columns, 1) IS NULL
           OR array_length(journal_hidden_columns, 1) <= 100),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tj_user_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY tj_user_prefs_owner ON public.tj_user_prefs
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE TRIGGER tj_user_prefs_updated_at
  BEFORE UPDATE ON public.tj_user_prefs
  FOR EACH ROW EXECUTE FUNCTION public.tj_set_updated_at();

-- No index beyond the primary key, and no seed. The PK on user_id is already the
-- only lookup this table has, and a row is written the first time a preference is
-- actually set — a seeded row of defaults would be a row that says nothing.
