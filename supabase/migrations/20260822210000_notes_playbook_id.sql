-- Anchor a note to a playbook, mirroring position_id exactly: nullable,
-- ON DELETE SET NULL, plain FK index. Deleting a playbook must not delete the
-- thinking recorded about it — the note falls to "no playbook" the same way a
-- note about a deleted trade falls to "no trade".

ALTER TABLE public.tj_notes
  ADD COLUMN playbook_id uuid REFERENCES public.tj_playbooks(id) ON DELETE SET NULL;

CREATE INDEX tj_notes_playbook_idx ON public.tj_notes (playbook_id);
