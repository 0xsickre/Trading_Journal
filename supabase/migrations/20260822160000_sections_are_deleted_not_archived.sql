-- A playbook section is deleted, never archived — and its order is unambiguous.
--
-- WHY ARCHIVING HAD TO GO, specifically for this one list. `is_active` exists so
-- a value can stop being offered while history keeps resolving it: `exit_reason`
-- needs it, because a closed trade points at the reason it closed for and that
-- pointer must keep rendering forever.
--
-- A section is not that. It is a HEADING over rules that are still being
-- written. Switching it off hid the heading from the playbook card while its
-- rules went on rendering underneath a label the list no longer supplied — and,
-- worse, an archived section holding NO rules disappeared from the card
-- entirely, so there was no way to get rid of it from the screen that owns it.
-- Archiving was standing in for a delete that did not exist yet. It does now
-- (`deletePlaybookSection`), which refuses while any rule is still filed there,
-- so the halfway state has nothing left to do.
--
-- Two consequences, and both are deliberate:
--   * the playbooks page loads this list with `activeOnly = false`, so a section
--     switched off from Settings → Dropdown Lists is still manageable rather
--     than stranded;
--   * the rows below are switched back on, so every other reader — the trade
--     form's checklist among them — resolves the same labels the card shows.
--
-- DUPLICATE ORDINALS. `sort_order` had ties (two 0s and two 2s): the seed in
-- 20260822140000 wrote 0..4 while `tj_add_option_item` computes `max + 1` over
-- the same list, and a hand-added section landed on an ordinal the seed already
-- used. Ties are not an error — the reader falls back to `id` — but they make
-- "move up" appear to do nothing on the first click, because the ordinal it
-- writes is one the neighbour already had. `movePlaybookSection` normalises the
-- whole list on every move, so this only has to fix the rows that exist now.

UPDATE public.tj_option_items i
   SET is_active = true
  FROM public.tj_option_lists l
 WHERE l.id = i.list_id
   AND l.key = 'rule_category'
   AND i.is_active = false;

WITH ranked AS (
  SELECT i.id,
         row_number() OVER (
           PARTITION BY i.list_id ORDER BY i.sort_order, i.created_at, i.id
         ) - 1 AS ord
    FROM public.tj_option_items i
    JOIN public.tj_option_lists l ON l.id = i.list_id
   WHERE l.key = 'rule_category'
)
UPDATE public.tj_option_items i
   SET sort_order = ranked.ord
  FROM ranked
 WHERE ranked.id = i.id
   AND i.sort_order IS DISTINCT FROM ranked.ord;
