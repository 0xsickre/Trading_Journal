"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import {
  ChevronDown,
  ChevronUp,
  FileText,
  Folder,
  FolderPlus,
  Inbox,
  Pin,
  Plus,
  Search,
  Settings2,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { plainText } from "@/lib/journal/notes/markdown";
import {
  noteInScope,
  type Note,
  type NoteFolder,
  type NoteScope,
} from "@/lib/journal/notes/note-types";
import {
  NoteEditor,
  NoteEmptyState,
  type TradeOption,
} from "@/components/journal/note-editor";
import {
  createFolder,
  createNote,
  deleteFolder,
  emptyTrash,
  moveFolder,
  updateFolder,
} from "@/app/(app)/notebook/actions";

function ScopeButton({
  active,
  icon: Icon,
  label,
  count,
  onClick,
}: {
  active: boolean;
  icon: typeof Folder;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
        active ? "bg-accent font-medium" : "hover:bg-accent/50",
      )}
    >
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
    </button>
  );
}

function FolderSettingsDialog({
  folder,
  open,
  onOpenChange,
}: {
  folder: NoteFolder;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(folder.name);
  const [template, setTemplate] = useState(folder.template_text ?? "");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Folder</DialogTitle>
          <DialogDescription>
            The template is written into the body of every new note in this folder.
            The point of a weekly review is that the questions are already there
            when you sit down.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Folder name"
          />
          <Textarea
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            placeholder="## Heading&#10;&#10;### Question&#10;"
            className="min-h-[12rem] font-mono text-xs"
          />
        </div>

        <DialogFooter className="sm:justify-between">
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await deleteFolder(folder.id);
                if (!res.ok) {
                  toast.error(res.error);
                  return;
                }
                toast.success(
                  res.orphaned > 0
                    ? `Folder deleted. ${res.orphaned} notes moved to "Unfiled".`
                    : "Folder deleted.",
                );
                onOpenChange(false);
                router.refresh();
              })
            }
          >
            <Trash2 className="mr-2 size-3.5" /> Delete folder
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await updateFolder(folder.id, {
                    name,
                    template_text: template,
                  });
                  if (!res.ok) {
                    toast.error(res.error);
                    return;
                  }
                  onOpenChange(false);
                  router.refresh();
                })
              }
            >
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function NotebookWorkbench({
  folders,
  notes,
  tags,
  trades,
}: {
  folders: NoteFolder[];
  notes: Note[];
  tags: string[];
  trades: TradeOption[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const [scope, setScope] = useState<NoteScope>({ kind: "all" });
  const [selectedId, setSelectedId] = useState<string | null>(
    notes.find((n) => n.deleted_at == null)?.id ?? null,
  );
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [editingFolder, setEditingFolder] = useState<NoteFolder | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [addingFolder, setAddingFolder] = useState(false);

  const counts = useMemo(() => {
    const byFolder = new Map<string, number>();
    let all = 0;
    let unfiled = 0;
    let trash = 0;
    for (const n of notes) {
      if (n.deleted_at != null) {
        trash++;
        continue;
      }
      all++;
      if (n.folder_id == null) unfiled++;
      else byFolder.set(n.folder_id, (byFolder.get(n.folder_id) ?? 0) + 1);
    }
    return { byFolder, all, unfiled, trash };
  }, [notes]);

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return notes.filter((n) => {
      if (!noteInScope(n, scope)) return false;
      if (tagFilter && !n.tags.some((t) => t === tagFilter)) return false;
      if (!q) return true;
      // Search the rendered text, not the source: looking for "bold" should find
      // a note that wrote it as **bold**.
      return (
        n.title.toLocaleLowerCase().includes(q) ||
        plainText(n.content).toLocaleLowerCase().includes(q)
      );
    });
  }, [notes, scope, tagFilter, query]);

  const selected =
    notes.find((n) => n.id === selectedId) ?? visible[0] ?? null;

  function newNote() {
    start(async () => {
      const res = await createNote({
        folder_id: scope.kind === "folder" ? scope.id : null,
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
    <>
      <div className="flex min-h-[36rem] min-w-0 flex-col gap-4 lg:flex-row print:block">
        {/* Sidebar */}
        <aside className="w-full shrink-0 space-y-4 lg:w-56 print:hidden">
          <Button className="w-full" onClick={newNote} disabled={pending}>
            <Plus className="mr-2 size-4" /> New note
          </Button>

          <div className="space-y-0.5">
            <ScopeButton
              active={scope.kind === "all"}
              icon={FileText}
              label="All notes"
              count={counts.all}
              onClick={() => setScope({ kind: "all" })}
            />
            {folders.map((f, i) => (
              <div key={f.id} className="group flex items-center gap-0.5">
                <div className="min-w-0 flex-1">
                  <ScopeButton
                    active={scope.kind === "folder" && scope.id === f.id}
                    icon={Folder}
                    label={f.name}
                    count={counts.byFolder.get(f.id) ?? 0}
                    onClick={() => setScope({ kind: "folder", id: f.id })}
                  />
                </div>
                <div className="flex opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    disabled={pending || i === 0}
                    onClick={() =>
                      start(async () => {
                        const res = await moveFolder(f.id, -1);
                        if (!res.ok) toast.error(res.error);
                        router.refresh();
                      })
                    }
                    aria-label="Move up"
                  >
                    <ChevronUp className="size-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    disabled={pending || i === folders.length - 1}
                    onClick={() =>
                      start(async () => {
                        const res = await moveFolder(f.id, 1);
                        if (!res.ok) toast.error(res.error);
                        router.refresh();
                      })
                    }
                    aria-label="Move down"
                  >
                    <ChevronDown className="size-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    onClick={() => setEditingFolder(f)}
                    aria-label="Folder settings"
                  >
                    <Settings2 className="size-3" />
                  </Button>
                </div>
              </div>
            ))}
            {counts.unfiled > 0 && (
              <ScopeButton
                active={scope.kind === "unfiled"}
                icon={Inbox}
                label="Unfiled"
                count={counts.unfiled}
                onClick={() => setScope({ kind: "unfiled" })}
              />
            )}
            <ScopeButton
              active={scope.kind === "trash"}
              icon={Trash2}
              label="Recently deleted"
              count={counts.trash}
              onClick={() => setScope({ kind: "trash" })}
            />
          </div>

          {addingFolder ? (
            <div className="flex gap-1">
              <Input
                autoFocus
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setAddingFolder(false);
                  if (e.key !== "Enter") return;
                  start(async () => {
                    const res = await createFolder(newFolderName);
                    if (!res.ok) {
                      toast.error(res.error);
                      return;
                    }
                    setNewFolderName("");
                    setAddingFolder(false);
                    router.refresh();
                  });
                }}
                placeholder="Name…"
                className="h-8"
              />
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              onClick={() => setAddingFolder(true)}
            >
              <FolderPlus className="mr-2 size-3.5" /> New folder
            </Button>
          )}

          {scope.kind === "trash" && counts.trash > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await emptyTrash();
                  if (!res.ok) toast.error(res.error);
                  else {
                    toast.success("Trash emptied.");
                    router.refresh();
                  }
                })
              }
            >
              Empty trash
            </Button>
          )}

          {tags.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Tags</p>
              <div className="flex flex-wrap gap-1">
                {tags.map((t) => (
                  <button key={t} type="button" onClick={() => setTagFilter(tagFilter === t ? null : t)}>
                    <Badge variant={tagFilter === t ? "default" : "outline"}>{t}</Badge>
                  </button>
                ))}
              </div>
            </div>
          )}
        </aside>

        {/* List */}
        <div className="w-full shrink-0 rounded-lg border lg:w-72 print:hidden">
          <div className="border-b p-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
                className="h-8 pl-7"
              />
            </div>
          </div>
          <div className="max-h-[32rem] overflow-y-auto lg:max-h-[40rem]">
            {visible.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">
                {scope.kind === "trash"
                  ? "The trash is empty."
                  : query || tagFilter
                    ? "No note matches."
                    : "No notes yet. Create the first one on the left."}
              </p>
            )}
            {visible.map((n) => {
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
                  <div className="flex items-center gap-1.5">
                    {n.pinned && <Pin className="size-3 shrink-0 text-muted-foreground" />}
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {n.title || "Untitled"}
                    </span>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {preview || "Empty note"}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {format(parseISO(n.updated_at), "d MMM yyyy")}
                    {n.tags.length > 0 && ` · ${n.tags.join(", ")}`}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Editor */}
        <div className="flex min-w-0 flex-1 flex-col rounded-lg border print:border-0">
          {selected ? (
            <NoteEditor
              key={selected.id}
              note={selected}
              folders={folders}
              tags={tags}
              trades={trades}
            />
          ) : (
            <NoteEmptyState onCreate={newNote} />
          )}
        </div>
      </div>

      {editingFolder && (
        <FolderSettingsDialog
          folder={editingFolder}
          open
          onOpenChange={(v) => !v && setEditingFolder(null)}
        />
      )}
    </>
  );
}
