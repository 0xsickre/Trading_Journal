import { describe, expect, it } from "vitest";
import {
  defaultNoteTitle,
  noteInScope,
  parseScopeKey,
  scopeKey,
  tradeLinkPatch,
  tradeNotesFolderId,
  type Note,
  type NoteFolder,
  type NoteScope,
} from "./note-types";

const note = (over: Partial<Note> = {}): Note => ({
  id: "n1",
  folder_id: "f1",
  title: "t",
  content: "",
  position_id: null,
  playbook_id: null,
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

describe("defaultNoteTitle", () => {
  it("reads the day key in the same 'd MMM yyyy' style the note list already uses", () => {
    expect(defaultNoteTitle("2026-08-19")).toBe("19 Aug 2026");
  });

  it("does NOT SHIFT A DAY through UTC parsing", () => {
    // A bare day key has no time or zone. Reading it through `new Date(string)`
    // (UTC midnight) and then formatting in a zone west of Greenwich would print
    // the day before — the exact bug `weekdayOf` and friends exist to avoid.
    // `parseISO` reads a date-only string as local midnight, so this must hold
    // regardless of the machine's own timezone.
    expect(defaultNoteTitle("2026-01-01")).toBe("1 Jan 2026");
    expect(defaultNoteTitle("2026-12-31")).toBe("31 Dec 2026");
  });
});

const folder = (over: Partial<NoteFolder> = {}): NoteFolder => ({
  id: "f1",
  name: "Trade Notes",
  template_text: null,
  sort_order: 0,
  icon: null,
  is_system: false,
  ...over,
});

describe("tradeNotesFolderId", () => {
  it("finds the folder flagged is_system", () => {
    const folders = [
      folder({ id: "a", name: "Weekly Review", is_system: false }),
      folder({ id: "b", is_system: true }),
    ];
    expect(tradeNotesFolderId(folders)).toBe("b");
  });

  it("survives a rename — matching is by flag, not by name", () => {
    expect(
      tradeNotesFolderId([folder({ name: "Renamed folder", is_system: true })]),
    ).toBe("f1");
  });

  it("returns null when the folder was deleted, rather than guessing", () => {
    expect(tradeNotesFolderId([folder({ is_system: false })])).toBeNull();
    expect(tradeNotesFolderId([])).toBeNull();
  });
});

describe("tradeLinkPatch", () => {
  const folders = [folder({ is_system: true })];

  it("bundles folder_id into the same patch when an unfiled note is linked to a trade", () => {
    expect(tradeLinkPatch(note({ folder_id: null }), folders, "trade-1")).toEqual({
      position_id: "trade-1",
      folder_id: "f1",
    });
  });

  it("leaves folder_id untouched when the note is already filed somewhere", () => {
    expect(tradeLinkPatch(note({ folder_id: "other-folder" }), folders, "trade-1")).toEqual({
      position_id: "trade-1",
    });
  });

  it("does not touch folder_id when unlinking a trade", () => {
    expect(tradeLinkPatch(note({ folder_id: null }), folders, null)).toEqual({
      position_id: null,
    });
  });

  it("still sets position_id when the Trade Notes folder does not exist", () => {
    expect(tradeLinkPatch(note({ folder_id: null }), [], "trade-1")).toEqual({
      position_id: "trade-1",
    });
  });
});
