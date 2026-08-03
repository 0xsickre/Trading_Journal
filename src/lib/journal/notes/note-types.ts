// Client-safe note types, mirroring tracker-types.ts and playbook-types.ts.

export type NoteFolder = {
  id: string;
  name: string;
  /** Pre-filled into a new note's body. Null means start blank. */
  template_text: string | null;
  sort_order: number;
};

export type Note = {
  id: string;
  /** Null when the note's folder was deleted — it shows under "no folder". */
  folder_id: string | null;
  title: string;
  content: string;
  /** Set when the note is attached to a trade. */
  position_id: string | null;
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
