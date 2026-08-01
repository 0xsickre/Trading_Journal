import { describe, expect, it } from "vitest";
import {
  noteInScope,
  parseScopeKey,
  scopeKey,
  type Note,
  type NoteScope,
} from "./note-types";

const note = (over: Partial<Note> = {}): Note => ({
  id: "n1",
  folder_id: "f1",
  title: "t",
  content: "",
  position_id: null,
  report_date: null,
  tags: [],
  pinned: false,
  deleted_at: null,
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
  ...over,
});

describe("scope keys", () => {
  it("round-trips every scope through the URL", () => {
    const scopes: NoteScope[] = [
      { kind: "all" },
      { kind: "unfiled" },
      { kind: "trash" },
      { kind: "folder", id: "abc-123" },
    ];
    for (const s of scopes) expect(parseScopeKey(scopeKey(s))).toEqual(s);
  });

  it("falls back to all for junk, so a bad URL shows notes rather than nothing", () => {
    expect(parseScopeKey(undefined)).toEqual({ kind: "all" });
    expect(parseScopeKey("")).toEqual({ kind: "all" });
    expect(parseScopeKey("nonsense")).toEqual({ kind: "all" });
  });
});

describe("noteInScope", () => {
  it("shows a deleted note ONLY in the trash", () => {
    // The property that makes delete feel like delete: a note is in exactly one
    // place. Without it a deleted note would still sit in its folder.
    const gone = note({ deleted_at: "2026-08-01T10:00:00Z" });
    expect(noteInScope(gone, { kind: "trash" })).toBe(true);
    expect(noteInScope(gone, { kind: "all" })).toBe(false);
    expect(noteInScope(gone, { kind: "folder", id: "f1" })).toBe(false);
    expect(noteInScope(gone, { kind: "unfiled" })).toBe(false);
  });

  it("keeps a live note out of the trash", () => {
    expect(noteInScope(note(), { kind: "trash" })).toBe(false);
  });

  it("puts a note whose folder was deleted under unfiled, not lost", () => {
    // folder_id is ON DELETE SET NULL, so this is the state after a folder is
    // removed — the note must remain reachable.
    const orphan = note({ folder_id: null });
    expect(noteInScope(orphan, { kind: "unfiled" })).toBe(true);
    expect(noteInScope(orphan, { kind: "all" })).toBe(true);
    expect(noteInScope(orphan, { kind: "folder", id: "f1" })).toBe(false);
  });

  it("matches a note to its own folder only", () => {
    expect(noteInScope(note(), { kind: "folder", id: "f1" })).toBe(true);
    expect(noteInScope(note(), { kind: "folder", id: "f2" })).toBe(false);
  });
});
