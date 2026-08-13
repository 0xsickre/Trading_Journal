-- Playbooks stop being seeded. They are the trader's own models.
--
-- THE TRAP THIS EXISTS TO DISARM. `tj_seed_playbooks` guarded itself with:
--
--     if exists (select 1 from tj_playbooks where user_id = target) then return;
--
-- which cannot tell a NEW user from one who deliberately deleted every
-- playbook — both have zero rows. `ensureDefaults()` runs on every dashboard
-- load, so deleting them appeared to work and then silently undid itself on the
-- next page view. Any attempt to clear the list without this change is a delete
-- that does not stay deleted.
--
-- WHY NOT SEED THEM AT ALL, rather than seed a better set:
--
--   A playbook is a statement of how THIS trader trades. The six that were
--   seeded — 2022 Model, OTE, Order Block, FVG, Turtle Soup, Silver Bullet —
--   are one intraday methodology's vocabulary, handed to every account
--   regardless of what it trades. Each arrived with three groups and ZERO
--   rules, so the checklist rendered a selector over nothing to tick, which
--   reads as a broken feature rather than an empty one.
--
--   The group names were seeded in Serbian ("Ulazak", "Izlazak", "Uslovi
--   tržišta") into an interface that is otherwise English — a second reason
--   these were never really defaults, just one user's leftovers promoted to
--   everyone's starting point.
--
-- The empty state is already handled: the checklist renders a "No playbook"
-- placeholder, and Settings › Playbooks can create them (`addPlaybook`).
--
-- Kept as a function rather than dropped. Four other seed functions call it —
-- `tj_seed_defaults`, and the ones added by the tracker, notebook and
-- field-placement migrations. Dropping it would mean editing all four and
-- re-issuing their REVOKE choreography; replacing the body leaves every caller
-- correct and puts the decision in one readable place.

CREATE OR REPLACE FUNCTION public.tj_seed_playbooks(target uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- Intentionally does nothing. See the note above. `target` is unused and the
  -- signature is unchanged so existing callers keep type-checking.
  return;
end;
$function$;

COMMENT ON FUNCTION public.tj_seed_playbooks(uuid) IS
  'No-op since 20260813200000. Playbooks are user-authored; seeding them re-created deleted rows on every dashboard load.';

-- Existing rows are NOT touched here.
--
-- This migration changes behaviour, and behaviour belongs in the repo. Deleting
-- somebody's playbooks is a data decision that belongs to whoever owns the
-- data — the same line drawn when 20260812220000 translated the lock messages
-- and left the seeded Douglas mantras alone. A user who wants to keep the six
-- defaults keeps them; one who clears them now stays cleared.
