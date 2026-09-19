"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MoreHorizontal, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { OptionItem, OptionList } from "@/lib/journal/types";
import {
  addList,
  addOption,
  countListUsage,
  countOptionUsage,
  deleteList,
  deleteOption,
  moveOptionToList,
  renameList,
  renameOption,
  reorderLists,
  reorderOptions,
  setListColor,
  setListPhase,
  setListSelection,
  setOptionColor,
  toggleOptionActive,
  type ListUsage,
} from "@/app/(app)/settings/actions";
import { editableLists } from "@/lib/journal/settings-lists";
import {
  Grip,
  useDragOrder,
  type DragHandleProps,
  type DragTargetProps,
} from "@/components/journal/drag-order";
import {
  CATEGORY_SELECTION_LABELS,
  FIELD_DEF_PHASE_LABELS,
  FIELD_DEF_PHASES,
  type CategorySelection,
  type FieldDefPhase,
} from "@/lib/journal/field-def-types";
import { usageKey } from "@/lib/journal/option-usage";
import { SEEDED_COLUMN_LISTS } from "@/lib/journal/settings-rules";

const PALETTE = [
  "#22c55e",
  "#ef4444",
  "#3b82f6",
  "#eab308",
  "#a855f7",
  "#06b6d4",
  "#f97316",
  "#ec4899",
  "#64748b",
];

/** The neutral dot for a category that has not been given a colour. */
function ColorDot({ color, className }: { color: string | null; className?: string }) {
  return (
    <span
      className={cn(
        "inline-block size-3 shrink-0 rounded-full",
        color ? "" : "border border-muted-foreground/40",
        className,
      )}
      style={color ? { backgroundColor: color } : undefined}
    />
  );
}

/**
 * When the trade form asks for this category.
 *
 * This is what replaced the four fixed groups. Those answered "which box does
 * it live in", which was never a question the trader had — every box was one
 * they could not rename or remove. The question they actually have is when they
 * want to be asked, and unlike the group, this one is theirs to set.
 */
/**
 * One tag at a time, or several.
 *
 * Worded as the trader sees it rather than as it is stored. Underneath this is
 * the field's type — `tags` or `select` — but "select" and "tags" are names for
 * two React components, not for a decision anybody makes about their own
 * method. The decision is whether a trade can carry two of these at once.
 */
function SelectionPicker({
  value,
  onChange,
  disabled,
}: {
  value: CategorySelection;
  onChange: (next: CategorySelection) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">Pick</label>
      <Select
        value={value}
        onValueChange={(v) => onChange(v as CategorySelection)}
        disabled={disabled}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(["multi", "single"] as const).map((m) => (
            <SelectItem key={m} value={m}>
              {CATEGORY_SELECTION_LABELS[m]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        {value === "multi"
          ? "The list stays open and every row carries a tick, so several can be chosen in one go."
          : "One click closes the list — for values that exclude each other, like a bias."}
      </p>
    </div>
  );
}

function PhasePicker({
  value,
  onChange,
  disabled,
}: {
  value: FieldDefPhase;
  onChange: (next: FieldDefPhase) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">Ask for it</label>
      <Select
        value={value}
        onValueChange={(v) => onChange(v as FieldDefPhase)}
        disabled={disabled}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {FIELD_DEF_PHASES.map((p) => (
            <SelectItem key={p} value={p}>
              {FIELD_DEF_PHASE_LABELS[p]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ColorPicker({
  value,
  onPick,
  disabled,
}: {
  value: string | null;
  onPick: (c: string | null) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          disabled={disabled}
          className={cn(
            "size-6 rounded-full border",
            value === c && "ring-2 ring-ring",
          )}
          style={{ backgroundColor: c }}
          aria-label={`Colour ${c}`}
          onClick={() => onPick(c)}
        />
      ))}
      <button
        type="button"
        disabled={disabled}
        className="size-6 rounded-full border bg-transparent text-[10px] text-muted-foreground"
        aria-label="No colour"
        onClick={() => onPick(null)}
      >
        ✕
      </button>
    </div>
  );
}

function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  function run(
    fn: () => Promise<{ ok: boolean; error?: string }>,
    after?: () => void,
  ) {
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        toast.error(res.error ?? "Failed");
        return;
      }
      after?.();
      router.refresh();
    });
  }
  return { pending, run };
}

/* ── Categories ──────────────────────────────────────────────────────────── */

function CategoryRow({
  list,
  drag,
}: {
  list: OptionList;
  /** Absent while the table is filtered — see `draggable` in `CategoriesTab`. */
  drag?: { target: DragTargetProps; handle: DragHandleProps };
}) {
  const { pending, run } = useAction();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [name, setName] = useState(list.label);
  const [color, setColor] = useState<string | null>(list.color);
  const [phase, setPhase] = useState<FieldDefPhase>(list.show_phase ?? "always");
  const [selection, setSelection] = useState<CategorySelection>(
    list.selection ?? "multi",
  );
  const [usage, setUsage] = useState<ListUsage | null>(null);
  const [, startCount] = useTransition();

  function openDelete() {
    setUsage(null);
    setConfirmOpen(true);
    startCount(async () => {
      const res = await countListUsage(list.id);
      setUsage(
        res.ok ? res.usage : { trades: -1, builtIn: false, customFieldLabels: [] },
      );
    });
  }

  function save() {
    const trimmed = name.trim();
    if (!trimmed) return;
    // Two writes because they are two columns with two server actions; the
    // rename is the one that can fail on validation, so it goes first and the
    // colour only follows a rename that stuck.
    run(
      async () => {
        if (trimmed !== list.label) {
          const res = await renameList(list.id, trimmed);
          if (!res.ok) return res;
        }
        if (color !== list.color) {
          const res = await setListColor(list.id, color);
          if (!res.ok) return res;
        }
        // Only when a field actually reads this list; `show_phase` is null
        // for the categories the form wires in by code.
        if (list.show_phase != null && phase !== list.show_phase) {
          const res = await setListPhase(list.id, phase);
          if (!res.ok) return res;
        }
        // Same guard as the phase: `null` means the form picks this category
        // itself, and there is no field row to change.
        if (list.selection != null && selection !== list.selection)
          return setListSelection(list.id, selection);
        return { ok: true as const };
      },
      () => setEditOpen(false),
    );
  }

  const blocked = usage?.builtIn === true;

  return (
    <tr
      {...drag?.target}
      data-drag-row
      className="border-b last:border-0 data-[dragging]:opacity-40"
    >
      <td className="px-3 py-2.5">
        {drag && <Grip {...drag.handle} className="inline-flex" />}
      </td>
      <td className="px-3 py-2.5 text-sm">{list.label}</td>
      <td className="px-3 py-2.5">
        <ColorDot color={list.color} />
      </td>
      <td className="px-3 py-2.5 text-right text-sm tabular-nums text-muted-foreground">
        {list.items.length}
      </td>
      <td className="w-10 px-3 py-2.5 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground"
              aria-label={`Options for ${list.label}`}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => {
                setName(list.label);
                setColor(list.color);
                setPhase(list.show_phase ?? "always");
                setSelection(list.selection ?? "multi");
                setEditOpen(true);
              }}
            >
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={openDelete}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>

      {/* Rendered from a `<td>` so the row stays valid HTML; the dialog itself
          portals out of the table either way. */}
      <td className="hidden">
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit category</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Name</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") save();
                  }}
                  disabled={pending}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Colour</label>
                <ColorPicker value={color} onPick={setColor} disabled={pending} />
              </div>
              {list.show_phase == null ? (
                <p className="text-xs text-muted-foreground">
                  Where this one appears, and how it is picked, are part of the
                  form — the exit reason sits with the exit, the miss reason only
                  on a missed setup. Categories you add yourself choose their
                  own.
                </p>
              ) : (
                <>
                  {/* Not for a category stored in a trade column: its shape is
                      fixed by the column, and the server refuses the switch. */}
                  {!SEEDED_COLUMN_LISTS.has(list.key) && (
                    <SelectionPicker
                      value={selection}
                      onChange={setSelection}
                      disabled={pending}
                    />
                  )}
                  <PhasePicker
                    value={phase}
                    onChange={setPhase}
                    disabled={pending}
                  />
                </>
              )}
            </div>
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => setEditOpen(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button onClick={save} disabled={pending || !name.trim()}>
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {blocked
                  ? `"${list.label}" can't be deleted`
                  : `Delete "${list.label}"?`}
              </DialogTitle>
              <DialogDescription asChild>
                <div className="space-y-3 text-sm">
                  {usage == null ? (
                    <p className="text-muted-foreground">Checking what uses it…</p>
                  ) : blocked ? (
                    <p>
                      A built-in field on the trade form reads this category.
                      There is no other list to point it at, so deleting would
                      leave that field&apos;s dropdown empty.
                    </p>
                  ) : (
                    <>
                      {usage.trades !== 0 && (
                        <p>
                          {usage.trades < 0 ? (
                            "Could not count how many trades use a tag from this category."
                          ) : (
                            <>
                              <strong>
                                {usage.trades}{" "}
                                {usage.trades === 1 ? "trade" : "trades"}
                              </strong>{" "}
                              {usage.trades === 1 ? "uses" : "use"} a tag from
                              this category, and{" "}
                              {usage.trades === 1 ? "keeps" : "keep"} it as text
                              — nothing is lost from your history.
                            </>
                          )}
                        </p>
                      )}
                      {usage.customFieldLabels.length > 0 && (
                        <p>
                          Your own field
                          {usage.customFieldLabels.length === 1 ? "" : "s"}{" "}
                          <strong>{usage.customFieldLabels.join(", ")}</strong>{" "}
                          {usage.customFieldLabels.length === 1
                            ? "reads"
                            : "read"}{" "}
                          this category and{" "}
                          {usage.customFieldLabels.length === 1 ? "is" : "are"}{" "}
                          deleted along with it.
                        </p>
                      )}
                      <p>
                        This <strong>cannot be undone</strong>. Every tag in the
                        category goes with it.
                      </p>
                    </>
                  )}
                </div>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => setConfirmOpen(false)}
                disabled={pending}
              >
                {blocked ? "Close" : "Cancel"}
              </Button>
              {!blocked && (
                <Button
                  variant="destructive"
                  disabled={pending || usage == null}
                  onClick={() =>
                    run(() => deleteList(list.id), () => setConfirmOpen(false))
                  }
                >
                  Delete
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </td>
    </tr>
  );
}

function NewCategoryDialog() {
  const { pending, run } = useAction();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string | null>(PALETTE[0]);
  const [phase, setPhase] = useState<FieldDefPhase>("always");
  const [selection, setSelection] = useState<CategorySelection>("multi");

  function create() {
    const trimmed = name.trim();
    if (!trimmed) return;
    run(
      async () => {
        const res = await addList(trimmed, trimmed, null, phase, selection);
        return res;
      },
      () => {
        setName("");
        setPhase("always");
        setSelection("multi");
        setOpen(false);
        toast.success("Category created");
      },
    );
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> Add category
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New category</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name your category"
                onKeyDown={(e) => {
                  if (e.key === "Enter") create();
                }}
                disabled={pending}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Colour</label>
              <ColorPicker value={color} onPick={setColor} disabled={pending} />
            </div>
            <SelectionPicker
              value={selection}
              onChange={setSelection}
              disabled={pending}
            />
            <PhasePicker value={phase} onChange={setPhase} disabled={pending} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={create} disabled={pending || !name.trim()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CategoriesTab({ lists }: { lists: OptionList[] }) {
  const [query, setQuery] = useState("");

  // The order is the trader's, and dragging is how they set it — the same
  // gesture, and the same hook, as the playbook's rules.
  const { order, target, handle } = useDragOrder(
    lists.map((l) => l.id),
    reorderLists,
  );
  const byId = new Map(lists.map((l) => [l.id, l]));
  const ordered = order
    .map((id) => byId.get(id))
    .filter((l): l is OptionList => l != null);

  const q = query.trim().toLowerCase();
  const shown = ordered.filter((l) => l.label.toLowerCase().includes(q));
  // Dropping onto a filtered list would write an order derived from rows the
  // trader cannot see, so the handle only appears on the whole list.
  const draggable = q === "";

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        A category groups tags. Deleting one is safe for your history — trades
        that used its tags keep the text.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <NewCategoryDialog />
        <div className="relative min-w-52 flex-1">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search categories"
            className="h-9 pl-8"
          />
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-md">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="w-8 px-3 py-2" />
              <th className="px-3 py-2 font-medium">Category name</th>
              <th className="px-3 py-2 font-medium">Colour</th>
              <th className="px-3 py-2 text-right font-medium">Tags</th>
              <th className="w-10 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No categories match.
                </td>
              </tr>
            ) : (
              shown.map((l) => (
                <CategoryRow
                  key={l.id}
                  list={l}
                  drag={
                    draggable
                      ? { target: target(l.id), handle: handle(l.id) }
                      : undefined
                  }
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Tags ────────────────────────────────────────────────────────────────── */

type TagRowData = { item: OptionItem; list: OptionList };

function TagRow({
  row,
  lists,
  used,
  canUp,
  canDown,
  onMove,
}: {
  row: TagRowData;
  lists: OptionList[];
  /** Trades carrying this tag, or null when the count could not be read. */
  used: number | null;
  canUp: boolean;
  canDown: boolean;
  onMove: (dir: -1 | 1) => void;
}) {
  const { pending, run } = useAction();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [name, setName] = useState(row.item.label);
  const [listId, setListId] = useState(row.list.id);
  const [color, setColor] = useState<string | null>(row.item.color);
  const [usedNow, setUsedNow] = useState<number | null>(null);
  const [, startCount] = useTransition();

  function openDelete() {
    setUsedNow(null);
    setConfirmOpen(true);
    // Re-counted head-on for the decision, rather than trusting the table's
    // in-memory tally — see `getAllOptionUsage` on why that one can undercount.
    startCount(async () => {
      const res = await countOptionUsage(row.item.id);
      setUsedNow(res.ok ? res.trades : -1);
    });
  }

  function save() {
    const trimmed = name.trim();
    if (!trimmed) return;
    run(
      async () => {
        if (trimmed !== row.item.label) {
          const res = await renameOption(row.item.id, trimmed);
          if (!res.ok) return res;
        }
        if (color !== row.item.color) {
          const res = await setOptionColor(row.item.id, color);
          if (!res.ok) return res;
        }
        if (listId !== row.list.id) return moveOptionToList(row.item.id, listId);
        return { ok: true as const };
      },
      () => setEditOpen(false),
    );
  }

  return (
    <tr className={cn("border-b last:border-0", !row.item.is_active && "opacity-60")}>
      <td className="px-3 py-2.5 text-sm">
        <span className="flex items-center gap-2">
          {row.item.label}
          {!row.item.is_active && (
            <Badge variant="secondary" className="text-[10px]">
              archived
            </Badge>
          )}
        </span>
      </td>
      <td className="px-3 py-2.5 text-sm">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <ColorDot color={row.list.color ?? row.item.color} />
          {row.list.label}
        </span>
      </td>
      <td className="px-3 py-2.5 text-right text-sm tabular-nums text-muted-foreground">
        {/* "—" when the scan failed: a 0 there would read as "safe to delete". */}
        {used == null ? <span title="Count unavailable">—</span> : used}
      </td>
      <td className="w-10 px-3 py-2.5 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground"
              aria-label={`Options for ${row.item.label}`}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => {
                setName(row.item.label);
                setListId(row.list.id);
                setColor(row.item.color);
                setEditOpen(true);
              }}
            >
              Edit
            </DropdownMenuItem>
            {/* Order is a real setting, not decoration: the trade form renders
                this same `sort_order`, so moving a tag here moves it in the
                dropdown the trader picks from. */}
            <DropdownMenuItem disabled={!canUp} onSelect={() => onMove(-1)}>
              Move up
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!canDown} onSelect={() => onMove(1)}>
              Move down
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                run(() => toggleOptionActive(row.item.id, !row.item.is_active))
              }
            >
              {row.item.is_active ? "Archive" : "Restore"}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={openDelete}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>

      <td className="hidden">
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit tag</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Tag name</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") save();
                  }}
                  disabled={pending}
                />
                {/* Said before the rename, not after: the trades come along, and
                    a user who expected the old tag to stay put deserves to know
                    that while they can still change their mind. */}
                {used != null && used > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Renaming also rewrites this on{" "}
                    <strong>
                      {used} {used === 1 ? "trade" : "trades"}
                    </strong>
                    , so the history stays together.
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Category</label>
                <Select value={listId} onValueChange={setListId} disabled={pending}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {lists.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Colour</label>
                <ColorPicker value={color} onPick={setColor} disabled={pending} />
                {/* Optional, and separate from the category's: the dropdown on
                    the trade form shows a tag's own colour when it has one.
                    Left unset, the row falls back to the category's. */}
                <p className="text-xs text-muted-foreground">
                  Leave unset to use the category&apos;s colour.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => setEditOpen(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button onClick={save} disabled={pending || !name.trim()}>
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete &ldquo;{row.item.label}&rdquo;?</DialogTitle>
              <DialogDescription asChild>
                <div className="space-y-3 text-sm">
                  {usedNow == null ? (
                    <p className="text-muted-foreground">Counting trades…</p>
                  ) : usedNow < 0 ? (
                    <p>Could not count the trades using this tag.</p>
                  ) : usedNow === 0 ? (
                    <p>No trade uses this tag.</p>
                  ) : (
                    <p>
                      <strong>
                        {usedNow} {usedNow === 1 ? "trade" : "trades"}
                      </strong>{" "}
                      {usedNow === 1 ? "carries" : "carry"} this value, and{" "}
                      {usedNow === 1 ? "it keeps it" : "they keep it"}. The value
                      is stored on the trade as text, so nothing is lost from
                      your history.
                    </p>
                  )}
                  <p className="text-muted-foreground">
                    To stop offering it on new trades while keeping its colour
                    and its place in reports, archive it instead.
                  </p>
                </div>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => setConfirmOpen(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={pending || usedNow == null}
                onClick={() =>
                  run(() => deleteOption(row.item.id), () => setConfirmOpen(false))
                }
              >
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </td>
    </tr>
  );
}

function NewTagDialog({ lists }: { lists: OptionList[] }) {
  const { pending, run } = useAction();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [listId, setListId] = useState(lists[0]?.id ?? "");

  function create() {
    const trimmed = name.trim();
    const list = lists.find((l) => l.id === listId);
    if (!trimmed || !list) return;
    run(
      () => addOption(list.key, trimmed),
      () => {
        setName("");
        setOpen(false);
        toast.success("Tag created");
      },
    );
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} disabled={lists.length === 0}>
        <Plus className="size-4" /> Add tag
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New tag</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Tag name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name your tag"
                onKeyDown={(e) => {
                  if (e.key === "Enter") create();
                }}
                disabled={pending}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Category</label>
              <Select value={listId} onValueChange={setListId} disabled={pending}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Pick a category" />
                </SelectTrigger>
                <SelectContent>
                  {lists.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={create} disabled={pending || !name.trim() || !listId}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

const ALL = "__all__";

function TagsTab({
  lists,
  usage,
}: {
  lists: OptionList[];
  /** Null when the usage scan failed — every count then reads "unavailable". */
  usage: Record<string, number> | null;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState(ALL);

  // Category first, then the order the trader PUT them in — never alphabetical.
  // `Entry TF` reads 1m, 5m, 15m, 1h, 4h, 1D; sorted by name it reads
  // "1D, 15m, 1h, 1m, 4h, 5m", which is not a timeframe list any more. The
  // dropdown on the trade form renders this same `sort_order`, so the table has
  // to show what the form will show.
  const rows = useMemo(() => {
    const out: TagRowData[] = [];
    for (const list of lists) {
      for (const item of list.items) out.push({ item, list });
    }
    return out.sort(
      (a, b) =>
        a.list.label.localeCompare(b.list.label) ||
        a.item.sort_order - b.item.sort_order,
    );
  }, [lists]);

  const router = useRouter();
  const [, startMove] = useTransition();

  /**
   * Move a tag within ITS OWN category.
   *
   * Ordinals are per-list, so the swap is computed against that list's items
   * rather than against the visible table — which may be filtered, searched, or
   * interleaving several categories. Reordering what you can see would write
   * ordinals derived from a view the database knows nothing about.
   */
  function move(row: TagRowData, dir: -1 | 1) {
    const siblings = [...row.list.items].sort(
      (a, b) => a.sort_order - b.sort_order,
    );
    const i = siblings.findIndex((it) => it.id === row.item.id);
    const target = i + dir;
    if (i < 0 || target < 0 || target >= siblings.length) return;
    const ids = siblings.map((it) => it.id);
    [ids[i], ids[target]] = [ids[target], ids[i]];
    startMove(async () => {
      const res = await reorderOptions(ids);
      if (!res.ok) toast.error(res.error);
      router.refresh();
    });
  }

  /** Where a tag sits inside its own category, for the move-up/down guards. */
  function positionIn(row: TagRowData) {
    const siblings = [...row.list.items].sort(
      (a, b) => a.sort_order - b.sort_order,
    );
    return {
      index: siblings.findIndex((it) => it.id === row.item.id),
      total: siblings.length,
    };
  }

  const shown = rows.filter(
    (r) =>
      (filter === ALL || r.list.id === filter) &&
      r.item.label.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Every tag you can pick on a trade, and the category it belongs to.
        Renaming one carries the trades that already use it along with it.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <NewTagDialog lists={lists} />
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="h-9 w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All categories</SelectItem>
            {lists.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative min-w-52 flex-1">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tags"
            className="h-9 pl-8"
          />
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-lg">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">Tag name</th>
              <th className="px-3 py-2 font-medium">Category</th>
              <th className="px-3 py-2 text-right font-medium">Used</th>
              <th className="w-10 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No tags match.
                </td>
              </tr>
            ) : (
              shown.map((r) => {
                const { index, total } = positionIn(r);
                return (
                  <TagRow
                    key={r.item.id}
                    row={r}
                    lists={lists}
                    used={usage == null ? null : (usage[usageKey(r.list.key, r.item.value)] ?? 0)}
                    canUp={index > 0}
                    canDown={index >= 0 && index < total - 1}
                    onMove={(dir) => move(r, dir)}
                  />
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Screen ──────────────────────────────────────────────────────────────── */

/**
 * Tags management: categories and tags, each in its own table.
 *
 * Two tabs rather than one screen of expanded cards. A card per category with
 * its tags spelled out inside reads fine at four categories and becomes a wall
 * at eleven — and it gives no answer at all to "where is this tag filed", which
 * is the question the Tags tab exists for. The storage `key` is deliberately
 * not shown anywhere: it is how the database finds the row, not something the
 * trader chose or can change.
 */
export function ListManager({
  lists,
  usage,
}: {
  lists: OptionList[];
  usage: Record<string, number> | null;
}) {
  const shown = editableLists(lists);
  return (
    <Tabs defaultValue="categories" className="space-y-4">
      <TabsList>
        <TabsTrigger value="categories">Categories</TabsTrigger>
        <TabsTrigger value="tags">Tags</TabsTrigger>
      </TabsList>
      <TabsContent value="categories">
        <CategoriesTab lists={shown} />
      </TabsContent>
      <TabsContent value="tags">
        <TagsTab lists={shown} usage={usage} />
      </TabsContent>
    </Tabs>
  );
}
