"use client";

import { useState } from "react";
import { Bookmark, Check, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  TEMPLATE_NAME_MAX,
  type DashboardTemplate,
} from "@/lib/journal/dashboard-templates";

/**
 * Saved dashboard arrangements.
 *
 * THE MODIFIED STATE IS THE WHOLE DESIGN. A template does not drive the page —
 * the live layout does, and the template id only records where that layout came
 * from. So the moment the reader touches the picker while a template is
 * selected, the two simply stop being equal, and this menu says so and offers
 * the three things they might have meant: overwrite it, keep both, or throw the
 * edit away.
 *
 * The alternative designs both lose something silently. Editing the saved
 * arrangement in place destroys the one they built without asking; forking it
 * automatically leaves them wondering which of two similarly-named layouts they
 * are on. Neither can be undone by a reader who did not realise it happened.
 */
export function TemplateMenu({
  templates,
  selectedId,
  modified,
  onSelect,
  onCreate,
  onSave,
  onRevert,
  onRename,
  onDelete,
}: {
  templates: readonly DashboardTemplate[];
  selectedId: string | null;
  /** True when the live layout has drifted from the selected template. */
  modified: boolean;
  onSelect: (id: string | null) => void;
  onCreate: (name: string) => void;
  onSave: () => void;
  onRevert: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [naming, setNaming] = useState<"new" | "rename" | null>(null);
  const [draft, setDraft] = useState("");

  const selected = templates.find((t) => t.id === selectedId) ?? null;

  function submitName() {
    const name = draft.trim();
    if (!name) return;
    if (naming === "new") onCreate(name);
    else if (naming === "rename" && selected) onRename(selected.id, name);
    setNaming(null);
    setDraft("");
  }

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        // A half-typed name left behind reopens as a puzzle. Closing discards.
        if (!open) {
          setNaming(null);
          setDraft("");
        }
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8">
          <Bookmark className="size-4" />
          {selected ? selected.name : "Layout"}
          {selected && modified && (
            <Badge variant="secondary" className="ml-1">
              Modified
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-72">
        {selected && modified && (
          <>
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              This layout no longer matches “{selected.name}”.
            </DropdownMenuLabel>
            <DropdownMenuItem onSelect={onSave}>
              <Check className="size-4" /> Save to “{selected.name}”
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                setNaming("new");
                setDraft("");
              }}
            >
              <Plus className="size-4" /> Save as new layout
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onRevert}>
              <RotateCcw className="size-4" /> Discard changes
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}

        {naming ? (
          <div className="p-2">
            <Input
              autoFocus
              value={draft}
              maxLength={TEMPLATE_NAME_MAX}
              placeholder={naming === "new" ? "Layout name" : selected?.name}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitName();
                if (e.key === "Escape") setNaming(null);
              }}
              className="h-8"
            />
            <div className="mt-2 flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-7"
                onClick={() => setNaming(null)}
              >
                Cancel
              </Button>
              <Button size="sm" className="h-7" onClick={submitName}>
                {naming === "new" ? "Create" : "Rename"}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              Saved layouts
            </DropdownMenuLabel>

            {templates.length === 0 && (
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground/70">
                None yet. Arrange the sections, then save.
              </DropdownMenuLabel>
            )}

            {templates.map((t) => (
              <DropdownMenuItem
                key={t.id}
                onSelect={() => onSelect(t.id)}
                className="justify-between"
              >
                <span className="truncate">{t.name}</span>
                {t.id === selectedId && <Check className="size-4 shrink-0" />}
              </DropdownMenuItem>
            ))}

            <DropdownMenuSeparator />

            {selected ? (
              <>
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    setNaming("rename");
                    setDraft(selected.name);
                  }}
                >
                  <Pencil className="size-4" /> Rename “{selected.name}”
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onDelete(selected.id)}>
                  <Trash2 className="size-4" /> Delete “{selected.name}”
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onSelect(null)}>
                  Use an unsaved layout
                </DropdownMenuItem>
              </>
            ) : (
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  setNaming("new");
                  setDraft("");
                }}
              >
                <Plus className="size-4" /> Save this layout…
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
