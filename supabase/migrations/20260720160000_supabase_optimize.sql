-- Supabase optimization pass (post TV snapshot migration):
-- remove legacy storage, fix RLS initplan, add FK/query indexes, harden RPC grants.

-- ---------------------------------------------------------------------------
-- 1) Legacy trade-images storage (replaced by TradingView /x/ URLs)
--    Bucket has 0 objects. Policies removed; delete bucket in Dashboard → Storage
--    (direct DELETE on storage.* is blocked by Supabase protect_delete trigger).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS tj_storage_delete ON storage.objects;
DROP POLICY IF EXISTS tj_storage_insert ON storage.objects;
DROP POLICY IF EXISTS tj_storage_select ON storage.objects;
DROP POLICY IF EXISTS tj_storage_update ON storage.objects;

-- ---------------------------------------------------------------------------
-- 2) RLS: (select auth.uid()) — avoids per-row auth re-evaluation (Supabase advisor)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS tj_accounts_owner ON public.tj_accounts;
CREATE POLICY tj_accounts_owner ON public.tj_accounts
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS tj_instruments_owner ON public.tj_instruments;
CREATE POLICY tj_instruments_owner ON public.tj_instruments
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS tj_lists_owner ON public.tj_option_lists;
CREATE POLICY tj_lists_owner ON public.tj_option_lists
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS tj_items_owner ON public.tj_option_items;
CREATE POLICY tj_items_owner ON public.tj_option_items
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS tj_positions_owner ON public.tj_positions;
CREATE POLICY tj_positions_owner ON public.tj_positions
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS tj_executions_owner ON public.tj_executions;
CREATE POLICY tj_executions_owner ON public.tj_executions
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS tj_images_owner ON public.tj_trade_images;
CREATE POLICY tj_images_owner ON public.tj_trade_images
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS tj_batches_owner ON public.tj_import_batches;
CREATE POLICY tj_batches_owner ON public.tj_import_batches
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS tj_rows_owner ON public.tj_import_rows;
CREATE POLICY tj_rows_owner ON public.tj_import_rows
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS tj_mappings_owner ON public.tj_column_mappings;
CREATE POLICY tj_mappings_owner ON public.tj_column_mappings
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ---------------------------------------------------------------------------
-- 3) Indexes: FK coverage + hot journal queries
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS tj_import_batches_account_idx
  ON public.tj_import_batches (account_id);

CREATE INDEX IF NOT EXISTS tj_import_rows_matched_position_idx
  ON public.tj_import_rows (matched_position_id);

CREATE INDEX IF NOT EXISTS tj_import_rows_user_idx
  ON public.tj_import_rows (user_id);

CREATE INDEX IF NOT EXISTS tj_trade_images_user_idx
  ON public.tj_trade_images (user_id);

CREATE INDEX IF NOT EXISTS tj_positions_user_created_idx
  ON public.tj_positions (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS tj_positions_account_created_idx
  ON public.tj_positions (account_id, created_at DESC)
  WHERE account_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4) TV snapshot URL integrity at DB layer
-- ---------------------------------------------------------------------------
ALTER TABLE public.tj_trade_images
  DROP CONSTRAINT IF EXISTS tj_trade_images_url_check;

ALTER TABLE public.tj_trade_images
  ADD CONSTRAINT tj_trade_images_url_check
  CHECK (image_url ~* '^https://www\.tradingview\.com/x/[a-z0-9]+/?$');

-- ---------------------------------------------------------------------------
-- 5) RPC hardening (security advisor)
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.tj_seed_defaults(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tj_seed_instruments_defaults(uuid) FROM PUBLIC, anon, authenticated;

-- tj_seed_my_defaults remains callable by authenticated (login fallback seed)
