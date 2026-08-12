"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";
import { getCurrentUser } from "@/lib/supabase/user";
import { deriveTitle } from "@/lib/journal/notes/markdown";

// The generated Update shapes rather than a loose record: a patch is built key
// by key here, and a typo in a column name would otherwise reach PostgREST.
type NoteUpdate = Database["public"]["Tables"]["tj_notes"]["Update"];
type FolderUpdate = Database["public"]["Tables"]["tj_note_folders"]["Update"];

type Result<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

function revalidateNotes() {
  revalidatePath("/notebook");
  revalidatePath("/", "layout");
}

/**
 * Tags on a note.
 *
 * Trimmed, deduped case-insensitively, and capped. The dedupe is
 * case-insensitive but keeps the FIRST spelling: "ICT" and "ict" are one tag,
 * and picking the first seen means the vocabulary does not silently rewrite what
 * the user typed the moment they type it differently.
 */
function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim();
    if (!tag) continue;
    const key = tag.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= 20) break;
  }
  return out;
}

const noteSchema = z
  .object({
    title: z.string().max(200).optional(),
    content: z.string().optional(),
    folder_id: z.uuid().nullable().optional(),
    position_id: z.uuid().nullable().optional(),
    report_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    tags: z.array(z.string()).optional(),
    pinned: z.boolean().optional(),
  })
  .strict();

export type NotePatch = z.infer<typeof noteSchema>;

/**
 * Record any new tag in the vocabulary.
 *
 * Tags are typed freely on the note and collected here rather than being picked
 * from a fixed list, because a vocabulary you must curate before writing is a
 * vocabulary you stop using. `ignoreDuplicates` makes this idempotent — the
 * common case is saving a note whose tags all already exist.
 */
async function rememberTags(userId: string, tags: string[]): Promise<void> {
  if (tags.length === 0) return;
  const supabase = await createClient();
  await supabase
    .from("tj_note_tags")
    .upsert(
      tags.map((name) => ({ user_id: userId, name })),
      { onConflict: "user_id,name", ignoreDuplicates: true },
    );
}

export async function createNote(
  input: NotePatch = {},
): Promise<Result<{ id: string }>> {
  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Neispravan unos." };

  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // A new note in a folder starts from that folder's template. The point of a
  // weekly review is that the questions are already there when you sit down.
  let content = parsed.data.content ?? "";
  if (!content && parsed.data.folder_id) {
    const { data: folder } = await supabase
      .from("tj_note_folders")
      .select("template_text")
      .eq("id", parsed.data.folder_id)
      .maybeSingle();
    content = folder?.template_text ?? "";
  }

  const tags = normalizeTags(parsed.data.tags);
  const { data, error } = await supabase
    .from("tj_notes")
    .insert({
      user_id: user.id,
      folder_id: parsed.data.folder_id ?? null,
      title: parsed.data.title?.trim() ?? "",
      content,
      position_id: parsed.data.position_id ?? null,
      report_date: parsed.data.report_date ?? null,
      tags,
      pinned: parsed.data.pinned ?? false,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };
  await rememberTags(user.id, tags);
  revalidateNotes();
  return { ok: true, id: data.id };
}

export async function updateNote(
  id: string,
  patch: NotePatch,
): Promise<Result<{ updated_at: string }>> {
  const parsed = noteSchema.safeParse(patch);
  if (!parsed.success) return { ok: false, error: "Neispravan unos." };

  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const next: NoteUpdate = {};
  if (parsed.data.content !== undefined) next.content = parsed.data.content;
  if (parsed.data.folder_id !== undefined) next.folder_id = parsed.data.folder_id;
  if (parsed.data.position_id !== undefined)
    next.position_id = parsed.data.position_id;
  if (parsed.data.report_date !== undefined)
    next.report_date = parsed.data.report_date;
  if (parsed.data.pinned !== undefined) next.pinned = parsed.data.pinned;

  let tags: string[] = [];
  if (parsed.data.tags !== undefined) {
    tags = normalizeTags(parsed.data.tags);
    next.tags = tags;
  }

  // An explicit title wins; an empty one falls back to the first line of the
  // body, because an untitled row in the list is useless for finding the note
  // again — and titling later is the normal way people write.
  if (parsed.data.title !== undefined) {
    const title = parsed.data.title.trim();
    if (title) next.title = title;
    else {
      // The body has to come from the patch when it is part of the same save,
      // and from the stored row otherwise. Deriving from `content ?? ""` would
      // blank the title of any note whose title alone was cleared.
      let body = parsed.data.content;
      if (body === undefined) {
        const { data: current } = await supabase
          .from("tj_notes")
          .select("content")
          .eq("id", id)
          .maybeSingle();
        body = current?.content ?? "";
      }
      next.title = deriveTitle(body, "");
    }
  }

  if (Object.keys(next).length === 0)
    return { ok: false, error: "No changes." };

  const { data, error } = await supabase
    .from("tj_notes")
    .update(next)
    .eq("id", id)
    .select("updated_at")
    .single();

  if (error) return { ok: false, error: error.message };
  await rememberTags(user.id, tags);
  revalidateNotes();
  return { ok: true, updated_at: data.updated_at };
}

/**
 * Move a note to Recently Deleted.
 *
 * Always soft. Notes are the one thing in this app with no other copy — a trade
 * can be re-imported from the broker, a paragraph you wrote cannot — so the
 * delete a user reaches for by reflex must be the recoverable one. `purgeNote`
 * is the deliberate second step.
 */
export async function deleteNote(id: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("tj_notes")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateNotes();
  return { ok: true };
}

export async function restoreNote(id: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("tj_notes")
    .update({ deleted_at: null })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateNotes();
  return { ok: true };
}

/** Delete for good. Only reachable from Recently Deleted. */
export async function purgeNote(id: string): Promise<Result> {
  const supabase = await createClient();
  // Scoped to already-deleted rows so a mis-passed id from anywhere else cannot
  // hard-delete a live note.
  const { error } = await supabase
    .from("tj_notes")
    .delete()
    .eq("id", id)
    .not("deleted_at", "is", null);
  if (error) return { ok: false, error: error.message };
  revalidateNotes();
  return { ok: true };
}

export async function emptyTrash(): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("tj_notes")
    .delete()
    .not("deleted_at", "is", null);
  if (error) return { ok: false, error: error.message };
  revalidateNotes();
  return { ok: true };
}

// --- Folders ----------------------------------------------------------------

const folderSchema = z
  .object({
    name: z.string().min(1).max(80),
    template_text: z.string().nullable().optional(),
  })
  .strict();

export async function createFolder(
  name: string,
  templateText?: string | null,
): Promise<Result<{ id: string }>> {
  const parsed = folderSchema.safeParse({
    name: name.trim(),
    template_text: templateText ?? null,
  });
  if (!parsed.success) return { ok: false, error: "The name cannot be empty." };

  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: last } = await supabase
    .from("tj_note_folders")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("tj_note_folders")
    .insert({
      user_id: user.id,
      name: parsed.data.name,
      template_text: parsed.data.template_text,
      sort_order: (last?.sort_order ?? -1) + 1,
    })
    .select("id")
    .single();

  if (error)
    return {
      ok: false,
      // The UNIQUE (user_id, name) surfaces as 23505; the raw message names the
      // constraint, which tells the user nothing.
      error: error.code === "23505" ? "A folder with that name already exists." : error.message,
    };
  revalidateNotes();
  return { ok: true, id: data.id };
}

export async function updateFolder(
  id: string,
  patch: { name?: string; template_text?: string | null },
): Promise<Result> {
  const next: FolderUpdate = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) return { ok: false, error: "The name cannot be empty." };
    next.name = name;
  }
  if (patch.template_text !== undefined)
    next.template_text = patch.template_text?.trim() || null;

  if (Object.keys(next).length === 0) return { ok: true };

  const supabase = await createClient();
  const { error } = await supabase.from("tj_note_folders").update(next).eq("id", id);
  if (error)
    return {
      ok: false,
      error: error.code === "23505" ? "A folder with that name already exists." : error.message,
    };
  revalidateNotes();
  return { ok: true };
}

/**
 * Delete a folder. Its notes survive.
 *
 * `folder_id` is ON DELETE SET NULL, so the notes fall to "no folder" rather
 * than disappearing with their parent. That is the whole reason folders are hard
 * deleted instead of soft: nothing is hidden behind an invisible parent, and the
 * notes are one click from being refiled.
 */
export async function deleteFolder(id: string): Promise<Result<{ orphaned: number }>> {
  const supabase = await createClient();

  const { count } = await supabase
    .from("tj_notes")
    .select("id", { count: "exact", head: true })
    .eq("folder_id", id)
    .is("deleted_at", null);

  const { error } = await supabase.from("tj_note_folders").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateNotes();
  return { ok: true, orphaned: count ?? 0 };
}

export async function moveFolder(
  id: string,
  direction: -1 | 1,
): Promise<Result> {
  const supabase = await createClient();
  const { data: siblings } = await supabase
    .from("tj_note_folders")
    .select("id")
    .order("sort_order")
    .order("id");
  if (!siblings) return { ok: false, error: "Read failed." };

  const i = siblings.findIndex((s) => s.id === id);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= siblings.length) return { ok: true };

  // Rewrite the whole list's ordinals from the reordered array. Swapping two
  // sort_order values instead deadlocks whenever rows already share one.
  const reordered = [...siblings];
  [reordered[i], reordered[j]] = [reordered[j], reordered[i]];
  for (const [ord, row] of reordered.entries()) {
    const { error } = await supabase
      .from("tj_note_folders")
      .update({ sort_order: ord })
      .eq("id", row.id);
    if (error) return { ok: false, error: error.message };
  }
  revalidateNotes();
  return { ok: true };
}
