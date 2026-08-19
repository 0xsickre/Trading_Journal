import "server-only";
import { createClient } from "@/lib/supabase/server";
import { selectAllPages } from "@/lib/supabase/paginate";
import type { Note, NoteFolder } from "./note-types";

/**
 * Purges notes that have sat in Recently Deleted for 30 days.
 *
 * Lazy, not `pg_cron`. This is a one-line DELETE run as a side effect of
 * loading the page, the same shape as `ensureDefaults()` on the dashboard —
 * installing a scheduler extension and keeping a scheduled job alive is
 * infrastructure this codebase reaches for only when there is no cheaper way,
 * and there is one here: the notebook is opened often enough that a purge on
 * load is never far behind the deadline.
 *
 * No explicit `user_id` filter — `createClient()` carries the caller's session
 * and RLS (`tj_notes_owner`) already scopes every row to its owner, the same
 * reliance `emptyTrash()` already has for its own unscoped DELETE.
 *
 * Failures are logged and swallowed: a purge that could not run this time runs
 * next time, and a page load must never fail because housekeeping did not.
 */
export async function purgeExpiredNotes(): Promise<void> {
  const supabase = await createClient();
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabase
    .from("tj_notes")
    .delete()
    .not("deleted_at", "is", null)
    .lt("deleted_at", cutoff);
  if (error) console.error("purgeExpiredNotes failed", error);
}

export async function getNoteFolders(): Promise<NoteFolder[]> {
  const supabase = await createClient();
  // `id` breaks ties: sort_order is not unique, and without a tiebreak two
  // folders sharing an ordinal reshuffle between identical page loads.
  const { data } = await supabase
    .from("tj_note_folders")
    .select("id, name, template_text, sort_order, icon")
    .order("sort_order")
    .order("id");
  return (data ?? []) as NoteFolder[];
}

/**
 * Every note, including deleted ones.
 *
 * Deleted notes come back because "Recently deleted" is a filter over the same
 * list rather than a separate folder — `noteInScope` does the splitting, and it
 * cannot show the trash from a list that already dropped it.
 *
 * Paged: a year of daily notes plus one per trade outgrows a single PostgREST
 * page, and a short page would silently hide the oldest notes — which reads as
 * data loss, not as an error.
 */
export async function getNotes(): Promise<Note[]> {
  const supabase = await createClient();
  const rows = await selectAllPages<Note>((from, to) =>
    supabase
      .from("tj_notes")
      .select(
        "id, folder_id, title, content, position_id, report_date, tags, pinned, deleted_at, created_at, updated_at",
      )
      // Pinned first, then most recently touched — the order the list renders in,
      // done here so the client never re-sorts a paged result.
      .order("pinned", { ascending: false })
      .order("updated_at", { ascending: false })
      .order("id")
      .range(from, to),
  );
  return rows;
}

/** The tag vocabulary. Separate from tj_option_items, deliberately. */
export async function getNoteTags(): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tj_note_tags")
    .select("name")
    .order("name");
  return (data ?? []).map((r) => r.name);
}

