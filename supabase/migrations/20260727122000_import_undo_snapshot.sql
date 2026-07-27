-- Make "undo import" actually complete.
--
-- `tj_import_rows.parsed` records the fills the import brought IN. For a merge
-- decision the importer deletes the position's existing fills and inserts the
-- new ones, so the pre-merge state existed only in a local variable during the
-- request — there was nothing on disk to roll back to.
--
-- This column stores that snapshot at commit time. Batches imported before this
-- migration can still have their created positions removed, but their merges
-- cannot be restored; the undo action reports that instead of pretending.

ALTER TABLE public.tj_import_rows
  ADD COLUMN prev_executions jsonb;

COMMENT ON COLUMN public.tj_import_rows.prev_executions IS
  'Executions replaced by a merge decision, captured so undo can restore them. NULL for create/skip rows and for batches predating this column.';
