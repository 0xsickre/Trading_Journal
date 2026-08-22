"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArchiveRestore,
  Archive,
  ChevronDown,
  ChevronUp,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { OptionItem, OptionList } from "@/lib/journal/types";
import {
  addOption,
  countOptionUsage,
  deleteOption,
  renameOption,
  setOptionColor,
  toggleOptionActive,
  reorderOptions,
} from "@/app/(app)/settings/actions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  optionUsageIsUnknown,
  type OptionUsage,
} from "@/lib/journal/option-usage";
import { editableLists } from "@/lib/journal/settings-lists";

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

/**
 * What an option is holding, counted when the popover opens.
 *
 * `null` means "not asked yet" and is what keeps the destructive controls
 * disabled: a delete button that is live before the count arrives is a delete
 * button that can be pressed on a number the user never saw. The three states
 * are therefore distinct and all three are rendered — unasked, counting, known.
 */
type UsageState = { usage: OptionUsage } | "loading" | null;

function UsageLine({ state }: { state: UsageState }) {
  if (state === null) return null;
  if (state === "loading") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        Counting trades…
      </p>
    );
  }
  if (optionUsageIsUnknown(state.usage)) {
    return (
      <p className="text-xs text-amber-600 dark:text-amber-500">
        Could not count the trades using this.
      </p>
    );
  }
  const n = state.usage.trades;
  return (
    <p className="text-xs text-muted-foreground">
      {n === 0
        ? "No trade uses this."
        : `Used by ${n} ${n === 1 ? "trade" : "trades"}.`}
    </p>
  );
}

function ItemRow({
  item,
  canUp,
  canDown,
  onMove,
}: {
  item: OptionItem;
  canUp: boolean;
  canDown: boolean;
  onMove: (dir: -1 | 1) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(item.label);
  const [open, setOpen] = useState(false);
  const [usage, setUsage] = useState<UsageState>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    start(async () => {
      const res = await fn();
      if (!res.ok) toast.error(res.error ?? "Failed");
      else router.refresh();
    });
  }

  // Counted on open, not with the page: this screen carries a hundred-odd
  // options and only the opened one needs a number. Re-counted on every open so
  // a popover reopened after an edit does not quote a stale figure.
  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) return;
    setUsage("loading");
    start(async () => {
      const res = await countOptionUsage(item.id);
      setUsage({ usage: { trades: res.ok ? res.trades : -1 } });
    });
  }

  const known = usage !== null && usage !== "loading" ? usage.usage : null;
  const inUse = known != null && known.trades > 0;
  const countReady = known != null;

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border px-2 py-1.5",
        !item.is_active && "opacity-60",
      )}
    >
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="size-4 shrink-0 rounded-full border"
            style={{ backgroundColor: item.color ?? "transparent" }}
            title="Edit option"
          />
        </PopoverTrigger>
        <PopoverContent className="w-72 space-y-3" align="start">
          <UsageLine state={usage} />

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Rename
            </label>
            <div className="flex gap-2">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-8"
              />
              <Button
                size="sm"
                className="h-8"
                disabled={pending || name.trim() === item.label}
                onClick={() => run(() => renameOption(item.id, name))}
              >
                Save
              </Button>
            </div>
            {/* Said before the rename, not after: the trades come along, and a
                user who expected the old tag to stay put deserves to know that
                while they can still change their mind. */}
            {inUse && (
              <p className="text-xs text-muted-foreground">
                Renaming also rewrites this on{" "}
                <strong>
                  {known.trades} {known.trades === 1 ? "trade" : "trades"}
                </strong>
                , so the history stays together.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Color
            </label>
            <div className="flex flex-wrap gap-1.5">
              {PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={cn(
                    "size-5 rounded-full border",
                    item.color === c && "ring-2 ring-ring",
                  )}
                  style={{ backgroundColor: c }}
                  onClick={() => run(() => setOptionColor(item.id, c))}
                />
              ))}
              <button
                type="button"
                className="size-5 rounded-full border bg-transparent text-[10px] text-muted-foreground"
                title="No color"
                onClick={() => run(() => setOptionColor(item.id, null))}
              >
                ✕
              </button>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            className="w-full"
            disabled={pending}
            onClick={() =>
              run(() => toggleOptionActive(item.id, !item.is_active))
            }
          >
            {item.is_active ? (
              <>
                <Archive className="size-4" /> Archive (hide from forms)
              </>
            ) : (
              <>
                <ArchiveRestore className="size-4" /> Restore
              </>
            )}
          </Button>

          {/* Delete sits below archive and reads as the heavier of the two,
              because it is: archive keeps the option resolvable, delete takes
              it out of the dropdown for good. It stays disabled until the count
              lands — see `UsageState`. */}
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={pending || !countReady}
            onClick={() => {
              // Nothing uses it: there is nothing to warn about, and a
              // confirmation for a free action only teaches people to click
              // through confirmations.
              if (!inUse) run(() => deleteOption(item.id));
              else setConfirmDelete(true);
            }}
          >
            <Trash2 className="size-4" /> Delete
          </Button>
        </PopoverContent>
      </Popover>

      <span className="flex-1 truncate text-sm">{item.label}</span>
      {!item.is_active && (
        <Badge variant="secondary" className="text-[10px]">
          archived
        </Badge>
      )}

      <div className="flex">
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground"
          disabled={!canUp || pending}
          onClick={() => onMove(-1)}
        >
          <ChevronUp className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground"
          disabled={!canDown || pending}
          onClick={() => onMove(1)}
        >
          <ChevronDown className="size-4" />
        </Button>
      </div>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete &ldquo;{item.label}&rdquo;?</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p>
                  <strong>
                    {known?.trades} {known?.trades === 1 ? "trade" : "trades"}
                  </strong>{" "}
                  {known?.trades === 1 ? "carries" : "carry"} this value, and{" "}
                  {known?.trades === 1 ? "it keeps it" : "they keep it"}. The
                  value is stored on the trade as text, so nothing is lost from
                  your history.
                </p>
                <p>
                  What goes is the option itself: it stops being offered when you
                  log a trade, loses its colour, and drops out of the fixed order
                  reports group by.
                </p>
                <p className="text-muted-foreground">
                  To stop offering it while keeping all of that, archive it
                  instead.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setConfirmDelete(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => {
                setConfirmDelete(false);
                setOpen(false);
                run(() => deleteOption(item.id));
              }}
            >
              <Trash2 className="size-4" /> Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ListCard({ list }: { list: OptionList }) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [pending, start] = useTransition();
  const [showArchived, setShowArchived] = useState(false);

  const visible = list.items.filter((i) => i.is_active || showArchived);
  const archivedCount = list.items.filter((i) => !i.is_active).length;

  function add() {
    const label = draft.trim();
    if (!label) return;
    start(async () => {
      const res = await addOption(list.key, label);
      if (!res.ok) toast.error(res.error);
      else {
        setDraft("");
        router.refresh();
      }
    });
  }

  function move(index: number, dir: -1 | 1) {
    const active = list.items.filter((i) => i.is_active || showArchived);
    const target = index + dir;
    if (target < 0 || target >= active.length) return;
    const ids = active.map((i) => i.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    start(async () => {
      // The result is read. `reorderOptions` reports a partial write since the
      // round-3 server pass; throwing it away here would keep that invisible —
      // the refresh below snaps the list back to whatever actually persisted,
      // which without a message reads as the drag simply not working.
      const res = await reorderOptions(ids);
      if (!res.ok) toast.error(res.error);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">{list.label}</CardTitle>
          <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
            {list.key}
          </code>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add option…"
            className="h-9"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          <Button size="icon" className="size-9" disabled={pending} onClick={add}>
            <Plus className="size-4" />
          </Button>
        </div>

        <div className="space-y-1.5">
          {visible.map((item, i) => (
            <ItemRow
              key={item.id}
              item={item}
              canUp={i > 0}
              canDown={i < visible.length - 1}
              onMove={(dir) => move(i, dir)}
            />
          ))}
        </div>

        {archivedCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-muted-foreground"
            onClick={() => setShowArchived((s) => !s)}
          >
            {showArchived
              ? "Hide archived"
              : `Show ${archivedCount} archived`}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function ListManager({ lists }: { lists: OptionList[] }) {
  const categories = [
    "Context",
    "ICT Setup",
    "Risk",
    "Psychology",
    null,
  ];
  // Filtered once, before the categories are walked, so a category left with
  // nothing but hidden lists disappears with them rather than rendering an
  // empty heading.
  const shown = editableLists(lists);
  return (
    <div className="space-y-8">
      {categories.map((cat) => {
        const group = shown.filter((l) => (l.category ?? null) === cat);
        if (group.length === 0) return null;
        return (
          <section key={cat ?? "other"} className="space-y-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <Pencil className="size-3.5" />
              {cat ?? "Other"}
            </h3>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {group.map((list) => (
                <ListCard key={list.id} list={list} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
