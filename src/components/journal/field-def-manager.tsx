"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronUp,
  MoreHorizontal,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  FIELD_DEF_GROUPS,
  FIELD_DEF_GROUP_LABELS,
  FIELD_DEF_TYPES,
  slugifyFieldKey,
  type FieldDef,
  type FieldDefGroup,
  type FieldDefType,
} from "@/lib/journal/field-def-types";
import {
  addFieldDef,
  countFieldDefUsage,
  deleteFieldDef,
  moveFieldDef,
  toggleFieldDefActive,
  updateFieldDef,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { OptionList } from "@/lib/journal/types";

const TYPE_LABELS: Record<FieldDefType, string> = {
  select: "Pick from a list",
  tags: "Multiple tags",
  text: "Tekst",
  textarea: "Long text",
  number: "Broj",
  url: "Link",
};

const NEEDS_LIST = (t: FieldDefType) => t === "select" || t === "tags";

/**
 * A field's usage, for the delete dialog. `null` = not asked yet, which keeps
 * Delete disabled until the count lands — same shape as `UsageState` on the
 * option/list level.
 */
type FieldUsageState = { trades: number } | "loading" | null;

function DeleteFieldMenu({ def }: { def: FieldDef }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [menuOpen, setMenuOpen] = useState(false);
  const [usage, setUsage] = useState<FieldUsageState>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  function onMenuOpenChange(next: boolean) {
    setMenuOpen(next);
    if (!next) return;
    setUsage("loading");
    start(async () => {
      const res = await countFieldDefUsage(def.id);
      setUsage({ trades: res.ok ? res.trades : -1 });
    });
  }

  function runDelete() {
    start(async () => {
      const res = await deleteFieldDef(def.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      router.refresh();
    });
  }

  const countReady = usage !== null && usage !== "loading";
  const trades = countReady ? (usage as { trades: number }).trades : 0;

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={onMenuOpenChange}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground"
            aria-label="More"
          >
            <MoreHorizontal className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            disabled={!countReady}
            variant="destructive"
            onSelect={(e) => {
              e.preventDefault();
              setConfirmOpen(true);
            }}
          >
            <Trash2 className="size-3.5" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete &ldquo;{def.label}&rdquo;?</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-3 text-sm">
                {trades < 0 ? (
                  <p>Could not count how many trades recorded this field.</p>
                ) : trades > 0 ? (
                  <p>
                    <strong>
                      {trades} {trades === 1 ? "trade" : "trades"}
                    </strong>{" "}
                    recorded a value here. The value stays in your data, but
                    without this definition nothing in the app can find or
                    label it again — it will not appear in reports, exports or
                    the trade form.
                  </p>
                ) : (
                  <p>No trade has recorded a value here yet.</p>
                )}
                <p className="text-muted-foreground">
                  To stop offering it on new trades while keeping past values
                  fully readable, archive it instead.
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
              disabled={pending}
              onClick={() => {
                setConfirmOpen(false);
                runDelete();
              }}
            >
              <Trash2 className="size-4" /> Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function FieldRow({
  def,
  lists,
  canUp,
  canDown,
}: {
  def: FieldDef;
  lists: OptionList[];
  canUp: boolean;
  canDown: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [label, setLabel] = useState(def.label);

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
        "flex flex-wrap items-center gap-2 rounded-md border px-2 py-1.5",
        !def.is_active && "opacity-60",
      )}
    >
      <Input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() => {
          if (label.trim() && label !== def.label)
            run(() => updateFieldDef(def.id, { label }));
        }}
        className="h-8 w-44"
        disabled={pending}
      />

      {/* The key is shown but never editable: it is where the values live, so
          changing it would orphan every value already written under it. */}
      <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
        {def.key}
      </code>

      <Select
        value={def.field_type}
        onValueChange={(v) =>
          run(() => updateFieldDef(def.id, { field_type: v as FieldDefType }))
        }
      >
        <SelectTrigger className="h-8 w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {FIELD_DEF_TYPES.map((t) => (
            <SelectItem key={t} value={t}>
              {TYPE_LABELS[t]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={def.group_id}
        onValueChange={(v) =>
          run(() => updateFieldDef(def.id, { group_id: v as FieldDefGroup }))
        }
      >
        <SelectTrigger className="h-8 w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {FIELD_DEF_GROUPS.map((g) => (
            <SelectItem key={g} value={g}>
              {FIELD_DEF_GROUP_LABELS[g]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {NEEDS_LIST(def.field_type) && (
        <Select
          value={def.list_key ?? "none"}
          onValueChange={(v) =>
            run(() => updateFieldDef(def.id, { list_key: v === "none" ? null : v }))
          }
        >
          <SelectTrigger className="h-8 w-44">
            <SelectValue placeholder="List" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No list (free text)</SelectItem>
            {lists.map((l) => (
              <SelectItem key={l.key} value={l.key}>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <div className="ml-auto flex items-center gap-1">
        {!def.is_active && <Badge variant="outline">archived</Badge>}
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={pending || !canUp}
          onClick={() => run(() => moveFieldDef(def.id, -1))}
          aria-label="Move up"
        >
          <ChevronUp className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={pending || !canDown}
          onClick={() => run(() => moveFieldDef(def.id, 1))}
          aria-label="Move down"
        >
          <ChevronDown className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={pending}
          onClick={() => run(() => toggleFieldDefActive(def.id, !def.is_active))}
          aria-label={def.is_active ? "Archive" : "Restore"}
          title={
            def.is_active
              ? "Remove from the form. Existing trades keep their value."
              : "Restore to the form."
          }
        >
          {def.is_active ? (
            <Archive className="size-3.5" />
          ) : (
            <ArchiveRestore className="size-3.5" />
          )}
        </Button>
        <DeleteFieldMenu def={def} />
      </div>
    </div>
  );
}

function AddFieldForm({ lists }: { lists: OptionList[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [label, setLabel] = useState("");
  const [type, setType] = useState<FieldDefType>("select");
  const [group, setGroup] = useState<FieldDefGroup>("setup");
  const [listKey, setListKey] = useState<string>("none");

  const key = slugifyFieldKey(label);

  function submit() {
    if (!label.trim()) return;
    start(async () => {
      const res = await addFieldDef({
        label,
        field_type: type,
        group_id: group,
        list_key: NEEDS_LIST(type) && listKey !== "none" ? listKey : null,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setLabel("");
      setListKey("none");
      router.refresh();
    });
  }

  return (
    <div className="space-y-2 rounded-md border border-dashed p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="Field name, e.g. ATR at entry"
          className="h-8 w-56"
          disabled={pending}
        />
        <Select value={type} onValueChange={(v) => setType(v as FieldDefType)}>
          <SelectTrigger className="h-8 w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FIELD_DEF_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {TYPE_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={group} onValueChange={(v) => setGroup(v as FieldDefGroup)}>
          <SelectTrigger className="h-8 w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FIELD_DEF_GROUPS.map((g) => (
              <SelectItem key={g} value={g}>
                {FIELD_DEF_GROUP_LABELS[g]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {NEEDS_LIST(type) && (
          <Select value={listKey} onValueChange={setListKey}>
            <SelectTrigger className="h-8 w-44">
              <SelectValue placeholder="List" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Create a new list</SelectItem>
              {lists.map((l) => (
                <SelectItem key={l.key} value={l.key}>
                  {l.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button size="sm" className="h-8" onClick={submit} disabled={pending}>
          <Plus className="size-3.5" /> Add field
        </Button>
      </div>
      {label.trim() && (
        <p className="text-xs text-muted-foreground">
          Key:{" "}
          <code className="rounded bg-muted px-1 py-0.5">{key}</code> — trajan je,
          values are stored under it, and the field is named by it in reports.
        </p>
      )}
    </div>
  );
}

/**
 * CRUD for user-defined trade fields.
 *
 * Archiving is offered, deletion is not. A field's values live on the trades
 * that recorded them; removing the definition would leave those values as
 * unlabelled jsonb keys, which is data loss disguised as tidying up.
 */
export function FieldDefManager({
  defs,
  lists,
}: {
  defs: FieldDef[];
  lists: OptionList[];
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Fields you add yourself. They appear on the form in the chosen group and
        immediately become a report dimension — with no code change at all.
      </p>

      <AddFieldForm lists={lists} />

      {FIELD_DEF_GROUPS.map((group) => {
        const inGroup = defs.filter((d) => d.group_id === group);
        return (
          <Card key={group}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {FIELD_DEF_GROUP_LABELS[group]}
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {inGroup.length} {inGroup.length === 1 ? "field" : "fields"}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {inGroup.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No fields in this group.
                </p>
              ) : (
                inGroup.map((def, i) => (
                  <FieldRow
                    key={def.id}
                    def={def}
                    lists={lists}
                    canUp={i > 0}
                    canDown={i < inGroup.length - 1}
                  />
                ))
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
