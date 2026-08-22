"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import { Eye, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { MarkdownView } from "@/components/journal/markdown-view";
import { plainText } from "@/lib/journal/notes/markdown";
import { defaultNoteTitle, type Note } from "@/lib/journal/notes/note-types";
import { createNote, deleteNote, updateNote } from "@/app/(app)/notebook/actions";

const AUTOSAVE_MS = 1200;

/**
 * A single note's title/body editor, with autosave.
 *
 * Deliberately smaller than `NoteEditor`: no folder, trade link, tags, pin, or
 * print/PDF — none of those apply to "a note about this playbook". Keyed by
 * note id at the call site, same as `NoteEditor`, so switching notes remounts
 * this with fresh state instead of syncing one over the other.
 */
function PlaybookNoteEditor({ note }: { note: Note }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [preview, setPreview] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(note.updated_at);
  const lastSaved = useRef({ title: note.title, content: note.content });

  useEffect(() => {
    if (title === lastSaved.current.title && content === lastSaved.current.content)
      return;

    setDirty(true);
    const timer = setTimeout(() => {
      void (async () => {
        const res = await updateNote(note.id, { title, content });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        lastSaved.current = { title, content };
        setSavedAt(res.updated_at);
        setDirty(false);
        router.refresh();
      })();
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [title, content, note.id, router]);

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title — leave empty to use the first line"
          className="h-auto min-w-0 flex-1 border-0 px-0 text-lg font-semibold shadow-none focus-visible:ring-0"
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setPreview((p) => !p)}
          title={preview ? "Back to writing" : "Preview"}
        >
          {preview ? (
            <>
              <Pencil className="mr-1 size-3.5" /> Write
            </>
          ) : (
            <>
              <Eye className="mr-1 size-3.5" /> Preview
            </>
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await deleteNote(note.id);
              if (!res.ok) toast.error(res.error);
              else {
                toast.success("Moved to trash — recoverable from Notebook.");
                router.refresh();
              }
            })
          }
          aria-label="Delete"
          title="Goes to the trash — recoverable from /notebook."
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      <div className="min-w-0 flex-1 p-4">
        {preview ? (
          <MarkdownView content={content} className="min-h-[16rem]" />
        ) : (
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Write in markdown — ## heading, - list, **bold**…"
            className="min-h-[16rem] resize-y font-mono text-sm leading-relaxed"
          />
        )}
      </div>

      <div className="border-t px-4 py-1.5 text-xs text-muted-foreground">
        {dirty
          ? "Saving…"
          : savedAt
            ? `Saved ${format(parseISO(savedAt), "d MMM yyyy, HH:mm")}`
            : "Not saved"}
      </div>
    </div>
  );
}

/**
 * The Notes tab of a playbook's detail page: notes anchored to this playbook
 * via `tj_notes.playbook_id`, not a reuse of the full Notebook workbench —
 * that one carries folders, trade-linking, tags and print/PDF, none of which
 * apply to writing about a setup.
 */
export function PlaybookNotesPanel({
  playbookId,
  notes,
  todayKey,
}: {
  playbookId: string;
  notes: Note[];
  todayKey: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [selectedId, setSelectedId] = useState<string | null>(notes[0]?.id ?? null);
  const selected = notes.find((n) => n.id === selectedId) ?? notes[0] ?? null;

  function newNote() {
    start(async () => {
      const res = await createNote({
        playbook_id: playbookId,
        title: defaultNoteTitle(todayKey),
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setSelectedId(res.id);
      router.refresh();
    });
  }

  return (
    <div className="flex min-h-[28rem] min-w-0 flex-col gap-4 lg:flex-row">
      <div className="w-full shrink-0 rounded-lg border lg:w-72">
        <div className="border-b p-2">
          <Button className="w-full" size="sm" onClick={newNote} disabled={pending}>
            <Plus className="mr-2 size-4" /> New note
          </Button>
        </div>
        <div className="max-h-[28rem] overflow-y-auto">
          {notes.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">
              No notes yet. Write the first one about this playbook.
            </p>
          )}
          {notes.map((n) => {
            const preview = plainText(n.content).slice(0, 90);
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => setSelectedId(n.id)}
                className={cn(
                  "block w-full border-b px-3 py-2 text-left last:border-b-0",
                  selected?.id === n.id ? "bg-accent" : "hover:bg-accent/50",
                )}
              >
                <span className="block truncate text-sm font-medium">
                  {n.title || "Untitled"}
                </span>
                <p className="truncate text-xs text-muted-foreground">
                  {preview || "Empty note"}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {format(parseISO(n.updated_at), "d MMM yyyy")}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col rounded-lg border">
        {selected ? (
          <PlaybookNoteEditor key={selected.id} note={selected} />
        ) : (
          <div className="flex flex-1 items-center justify-center p-8">
            <div className="text-center">
              <p className="text-sm text-muted-foreground">
                Pick a note on the left, or create a new one.
              </p>
              <Button className="mt-3" onClick={newNote} disabled={pending}>
                New note
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
