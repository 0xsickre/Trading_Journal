"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
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
import { NOTE_FOLDER_ICON_NAMES, folderIcon } from "@/lib/journal/notes/folder-icons";
import type { NoteFolder } from "@/lib/journal/notes/note-types";
import { deleteFolder, updateFolder } from "@/app/(app)/notebook/actions";

export function FolderSettingsDialog({
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
  const [icon, setIcon] = useState<string | null>(folder.icon);

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

          {/* One click sets the icon; it is not staged separately from the rest
              of the dialog — "Save" below commits name, template and icon in
              the same call, same as every other field here. */}
          <div className="flex flex-wrap gap-1.5">
            {NOTE_FOLDER_ICON_NAMES.map((iconName) => {
              const Icon = folderIcon(iconName);
              const selected = icon === iconName;
              return (
                <button
                  key={iconName}
                  type="button"
                  aria-label={iconName}
                  aria-pressed={selected}
                  onClick={() => setIcon(selected ? null : iconName)}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-md border",
                    selected
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-transparent text-muted-foreground hover:bg-accent",
                  )}
                >
                  <Icon className="size-4" />
                </button>
              );
            })}
          </div>

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
                    icon,
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
