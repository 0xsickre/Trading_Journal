"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import { sr } from "date-fns/locale";
import {
  ArchiveRestore,
  Eye,
  Link2,
  Pencil,
  Pin,
  PinOff,
  Printer,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { MarkdownView } from "@/components/journal/markdown-view";
import type { Note, NoteFolder } from "@/lib/journal/notes/note-types";
import {
  deleteNote,
  purgeNote,
  restoreNote,
  updateNote,
} from "@/app/(app)/notebook/actions";

export type TradeOption = {
  id: string;
  label: string;
  symbol: string | null;
  openedAt: string | null;
};

const UNFILED = "__none__";
const AUTOSAVE_MS = 1200;

/**
 * The note editor.
 *
 * Autosaves rather than offering a Save button. A note is written in bursts over
 * a long sitting, and the one thing that must never happen to writing is losing
 * it to a navigation — which is exactly what a manual Save invites.
 */
export function NoteEditor({
  note,
  folders,
  tags: vocabulary,
  trades,
}: {
  note: Note;
  folders: NoteFolder[];
  tags: string[];
  trades: TradeOption[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [tags, setTags] = useState<string[]>(note.tags);
  const [tagDraft, setTagDraft] = useState("");
  const [preview, setPreview] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(note.updated_at);
  const [dirty, setDirty] = useState(false);

  const deleted = note.deleted_at != null;

  // Every edit is compared against what the server last confirmed, so a save
  // that lands while typing continues does not mark clean work dirty.
  //
  // There is deliberately no effect syncing state back from `note`. The
  // workbench keys this component by note id, so selecting another note remounts
  // it with fresh state — and a sync effect would additionally fire on the
  // `router.refresh()` that follows each autosave, overwriting whatever was
  // typed during that round trip with the server's slightly older copy.
  const lastSaved = useRef({ title: note.title, content: note.content });

  useEffect(() => {
    if (deleted) return;
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
        // Refresh so the list's title and ordering follow the edit. Deliberately
        // after the save, not on every keystroke.
        router.refresh();
      })();
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [title, content, note.id, deleted, router]);

  function patch(fields: Parameters<typeof updateNote>[1], message?: string) {
    start(async () => {
      const res = await updateNote(note.id, fields);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (message) toast.success(message);
      router.refresh();
    });
  }

  function addTag(raw: string) {
    const tag = raw.trim().replace(/,$/, "").trim();
    if (!tag) return;
    if (tags.some((t) => t.toLocaleLowerCase() === tag.toLocaleLowerCase())) {
      setTagDraft("");
      return;
    }
    const next = [...tags, tag];
    setTags(next);
    setTagDraft("");
    patch({ tags: next });
  }

  function removeTag(tag: string) {
    const next = tags.filter((t) => t !== tag);
    setTags(next);
    patch({ tags: next });
  }

  const suggestions = vocabulary
    .filter(
      (t) =>
        t.toLocaleLowerCase().includes(tagDraft.trim().toLocaleLowerCase()) &&
        !tags.some((x) => x.toLocaleLowerCase() === t.toLocaleLowerCase()),
    )
    .slice(0, 6);

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {deleted && (
        <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-4 py-2 print:hidden">
          <span className="text-sm text-muted-foreground">
            Beleška je u korpi i ne može se menjati dok je ne vratiš.
          </span>
          <div className="ml-auto flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await restoreNote(note.id);
                  if (!res.ok) toast.error(res.error);
                  else router.refresh();
                })
              }
            >
              <ArchiveRestore className="mr-2 size-3.5" /> Vrati
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await purgeNote(note.id);
                  if (!res.ok) toast.error(res.error);
                  else router.refresh();
                })
              }
            >
              <Trash2 className="mr-2 size-3.5" /> Obriši zauvek
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 print:hidden">
        <Select
          value={note.folder_id ?? UNFILED}
          onValueChange={(v) =>
            patch({ folder_id: v === UNFILED ? null : v })
          }
          disabled={deleted || pending}
        >
          <SelectTrigger className="h-8 w-44">
            <SelectValue placeholder="Folder" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNFILED}>Bez foldera</SelectItem>
            {folders.map((f) => (
              <SelectItem key={f.id} value={f.id}>
                {f.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={note.position_id ?? UNFILED}
          onValueChange={(v) =>
            patch({ position_id: v === UNFILED ? null : v })
          }
          disabled={deleted || pending}
        >
          <SelectTrigger className="h-8 w-44">
            <SelectValue placeholder="Bez trejda" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNFILED}>Bez trejda</SelectItem>
            {trades.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.label}
                {t.symbol ? ` · ${t.symbol}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {note.position_id && (
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/trades/${note.position_id}/edit`}>
              <Link2 className="mr-1 size-3.5" /> Otvori trejd
            </Link>
          </Button>
        )}

        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPreview((p) => !p)}
            title={preview ? "Nazad na pisanje" : "Pregled"}
          >
            {preview ? (
              <>
                <Pencil className="mr-1 size-3.5" /> Piši
              </>
            ) : (
              <>
                <Eye className="mr-1 size-3.5" /> Pregled
              </>
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            disabled={deleted || pending}
            onClick={() =>
              patch(
                { pinned: !note.pinned },
                note.pinned ? "Otkačeno" : "Zakačeno na vrh",
              )
            }
            aria-label={note.pinned ? "Otkači" : "Zakači"}
          >
            {note.pinned ? (
              <PinOff className="size-3.5" />
            ) : (
              <Pin className="size-3.5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => window.print()}
            aria-label="Štampaj / sačuvaj kao PDF"
            title="Štampaj — u dijalogu izaberi „Sačuvaj kao PDF”"
          >
            <Printer className="size-3.5" />
          </Button>
          {!deleted && (
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
                    toast.success("Premešteno u korpu");
                    router.refresh();
                  }
                })
              }
              aria-label="Obriši"
              title="Ide u korpu — ništa se ne gubi odmah."
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>
      </div>

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-3 p-4">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Naslov — ostavi prazno da se uzme prvi red"
            disabled={deleted}
            className="h-auto border-0 px-0 text-xl font-semibold shadow-none focus-visible:ring-0"
          />

          <div className="flex flex-wrap items-center gap-1.5 print:hidden">
            {tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="gap-1">
                {tag}
                {!deleted && (
                  <button
                    type="button"
                    onClick={() => removeTag(tag)}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={`Ukloni ${tag}`}
                  >
                    ×
                  </button>
                )}
              </Badge>
            ))}
            {!deleted && (
              <div className="relative">
                <Input
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") {
                      e.preventDefault();
                      addTag(tagDraft);
                    }
                  }}
                  onBlur={() => addTag(tagDraft)}
                  placeholder="+ tag"
                  className="h-7 w-28 text-xs"
                />
                {tagDraft.trim() && suggestions.length > 0 && (
                  <div className="absolute z-20 mt-1 w-40 rounded-md border bg-popover p-1 shadow-md">
                    {suggestions.map((s) => (
                      <button
                        key={s}
                        type="button"
                        // onMouseDown, not onClick: onBlur fires first otherwise
                        // and the suggestion is gone before the click lands.
                        onMouseDown={(e) => {
                          e.preventDefault();
                          addTag(s);
                        }}
                        className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-accent"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {preview ? (
            <MarkdownView content={content} className="min-h-[24rem]" />
          ) : (
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              disabled={deleted}
              placeholder="Piši u markdown-u — ## naslov, - lista, **podebljano**…"
              className="min-h-[24rem] resize-y font-mono text-sm leading-relaxed"
            />
          )}

          {/* The printed page is the note, not the app: only this block survives. */}
          <div className="hidden print:block">
            <h1 className="text-xl font-semibold">{title || "Bez naslova"}</h1>
            <MarkdownView content={content} />
          </div>
        </div>
      </div>

      <div className="border-t px-4 py-1.5 text-xs text-muted-foreground print:hidden">
        {deleted
          ? `Obrisano ${format(parseISO(note.deleted_at!), "d. MMM yyyy. HH:mm", { locale: sr })}`
          : dirty
            ? "Čuvanje…"
            : savedAt
              ? `Sačuvano ${format(parseISO(savedAt), "d. MMM yyyy. HH:mm", { locale: sr })}`
              : "Nije sačuvano"}
      </div>
    </div>
  );
}

/** Shown when nothing is selected. */
export function NoteEmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className={cn("flex flex-1 items-center justify-center p-8")}>
      <div className="text-center">
        <p className="text-sm text-muted-foreground">
          Izaberi belešku levo ili napravi novu.
        </p>
        <Button className="mt-3" onClick={onCreate}>
          Nova beleška
        </Button>
      </div>
    </div>
  );
}
