"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArchiveRestore,
  Archive,
  ChevronDown,
  ChevronUp,
  Pencil,
  Plus,
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
  renameOption,
  setOptionColor,
  toggleOptionActive,
  reorderOptions,
} from "@/app/(app)/settings/actions";

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

function ItemRow({
  item,
  listKey,
  canUp,
  canDown,
  onMove,
}: {
  item: OptionItem;
  listKey: string;
  canUp: boolean;
  canDown: boolean;
  onMove: (dir: -1 | 1) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(item.label);
  const [open, setOpen] = useState(false);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    start(async () => {
      const res = await fn();
      if (!res.ok) toast.error(res.error ?? "Failed");
      else router.refresh();
    });
  }

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border px-2 py-1.5",
        !item.is_active && "opacity-60",
      )}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="size-4 shrink-0 rounded-full border"
            style={{ backgroundColor: item.color ?? "transparent" }}
            title="Edit option"
          />
        </PopoverTrigger>
        <PopoverContent className="w-64 space-y-3" align="start">
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
      await reorderOptions(ids);
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
              listKey={list.key}
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
  return (
    <div className="space-y-8">
      {categories.map((cat) => {
        const group = lists.filter((l) => (l.category ?? null) === cat);
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
