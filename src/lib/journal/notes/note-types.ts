// Client-safe note types, mirroring tracker-types.ts and playbook-types.ts.

import { format, parseISO } from "date-fns";
import { DATE } from "@/lib/journal/time";

/** How long a deleted note stays in Recently Deleted before it is purged. */
export const NOTE_TRASH_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Whether a note is past its 30 days in Recently Deleted — the rows
 * `purgeExpiredNotes` deletes. The notebook runs the purge alongside its reads
 * and drops these from what it read, so the page shows the state after
 * housekeeping without waiting for it first.
 */
export function isExpiredNote(note: { deleted_at: string | null }, now = Date.now()): boolean {
  return note.deleted_at != null && Date.parse(note.deleted_at) < now - NOTE_TRASH_MS;
}

export type NoteFolder = {
  id: string;
  name: string;
  /** Pre-filled into a new note's body. Null means start blank. */
  template_text: string | null;
  sort_order: number;
  /** Name of an entry in `NOTE_FOLDER_ICONS`. Null means the plain folder glyph. */
  icon: string | null;
  /** True for the seeded folder automation depends on. Cannot be deleted. */
  is_system: boolean;
};

export type Note = {
  id: string;
  /** Null when the note's folder was deleted — it shows under "no folder". */
  folder_id: string | null;
  title: string;
  content: string;
  /** Set when the note is attached to a trade. */
  position_id: string | null;
  /** Set when the note is attached to a playbook. */
  playbook_id: string | null;
  report_date: string | null;
  tags: string[];
  pinned: boolean;
  /** Set means the note is in Recently Deleted, not gone. */
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Sidebar selection.
 *
 * "Recently deleted" is a FILTER over `deleted_at`, not a folder. A real folder
 * would have to be moved into on delete, which forgets where the note came from
 * and leaves restore with nowhere to put it back.
 */
export type NoteScope =
  | { kind: "all" }
  | { kind: "folder"; id: string }
  | { kind: "unfiled" }
  | { kind: "trash" };

const ALL_SCOPE: NoteScope = { kind: "all" };

export function scopeKey(scope: NoteScope): string {
  return scope.kind === "folder" ? `folder:${scope.id}` : scope.kind;
}

export function parseScopeKey(key: string | null | undefined): NoteScope {
  if (!key) return ALL_SCOPE;
  if (key.startsWith("folder:")) return { kind: "folder", id: key.slice(7) };
  if (key === "unfiled" || key === "trash" || key === "all")
    return { kind: key };
  return ALL_SCOPE;
}

/**
 * The title a freshly created note starts with: the day it was opened, in the
 * account's own timezone — the same day key `/daily` and `/calendar` use, not
 * the browser's.
 *
 * Not empty and not "Untitled". A blank note in a list of thirty reads as
 * nothing to go on; today's date is at minimum a fact the writer can search
 * for later, and it is exactly as disposable as any other text in the title
 * field — delete it, append to it, or leave it.
 *
 * `dayKey` in, not a `Date`: the caller already resolved "today" against an
 * account's timezone (`todayInTz`), and re-deriving it from a `Date` here
 * would risk the same off-by-one that day keys exist to avoid. `parseISO` on a
 * bare `yyyy-MM-dd` (no time, no zone) reads it as local midnight, which is
 * exactly right for a key that already IS a local calendar date — the same
 * call the note list already makes to format `updated_at`.
 */
export function defaultNoteTitle(dayKey: string): string {
  return format(parseISO(dayKey), DATE);
}

/**
 * The seeded "Trade Notes" folder, found by its `is_system` flag rather than
 * its name — the flag is protected from deletion and not exposed for
 * editing, so it is the durable identity; the name is just a label and can
 * be renamed freely without breaking this lookup. `null` means the caller
 * falls back to doing nothing extra: never recreates the folder, never
 * throws.
 */
export function tradeNotesFolderId(folders: readonly NoteFolder[]): string | null {
  return folders.find((f) => f.is_system)?.id ?? null;
}

/**
 * The patch to send when a note's trade link changes.
 *
 * Bundles `folder_id` into the SAME patch as `position_id` — one server call,
 * not a race between two — but only when a note that has no folder yet is
 * being linked to a real trade. A note already filed somewhere is left there;
 * unlinking a trade (`newPositionId === null`) never touches the folder.
 */
export function tradeLinkPatch(
  note: Pick<Note, "folder_id">,
  folders: readonly NoteFolder[],
  newPositionId: string | null,
): { position_id: string | null; folder_id?: string } {
  if (newPositionId == null || note.folder_id != null) {
    return { position_id: newPositionId };
  }
  const folderId = tradeNotesFolderId(folders);
  return folderId ? { position_id: newPositionId, folder_id: folderId } : { position_id: newPositionId };
}

/** Whether a note belongs in the given scope. Trash is exclusive on purpose. */
export function noteInScope(note: Note, scope: NoteScope): boolean {
  const deleted = note.deleted_at != null;
  if (scope.kind === "trash") return deleted;
  // Every other scope hides deleted notes: a note in the trash must appear in
  // exactly one place, or "delete" would look like it did nothing.
  if (deleted) return false;
  if (scope.kind === "all") return true;
  if (scope.kind === "unfiled") return note.folder_id == null;
  return note.folder_id === scope.id;
}
