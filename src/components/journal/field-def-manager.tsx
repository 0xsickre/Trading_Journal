"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, ArchiveRestore, ChevronDown, ChevronUp, Plus } from "lucide-react";
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
  moveFieldDef,
  toggleFieldDefActive,
  updateFieldDef,
} from "@/app/(app)/settings/actions";
import type { OptionList } from "@/lib/journal/types";

const TYPE_LABELS: Record<FieldDefType, string> = {
  select: "Izbor iz liste",
  tags: "Više oznaka",
  text: "Tekst",
  textarea: "Duži tekst",
  number: "Broj",
  url: "Link",
};

const NEEDS_LIST = (t: FieldDefType) => t === "select" || t === "tags";

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
      if (!res.ok) toast.error(res.error ?? "Nije uspelo");
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
            <SelectValue placeholder="Lista" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Bez liste (slobodan unos)</SelectItem>
            {lists.map((l) => (
              <SelectItem key={l.key} value={l.key}>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <div className="ml-auto flex items-center gap-1">
        {!def.is_active && <Badge variant="outline">arhivirano</Badge>}
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={pending || !canUp}
          onClick={() => run(() => moveFieldDef(def.id, -1))}
          aria-label="Pomeri gore"
        >
          <ChevronUp className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={pending || !canDown}
          onClick={() => run(() => moveFieldDef(def.id, 1))}
          aria-label="Pomeri dole"
        >
          <ChevronDown className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={pending}
          onClick={() => run(() => toggleFieldDefActive(def.id, !def.is_active))}
          aria-label={def.is_active ? "Arhiviraj" : "Vrati"}
          title={
            def.is_active
              ? "Skloni sa forme. Postojeći trejdovi zadržavaju vrednost."
              : "Vrati na formu."
          }
        >
          {def.is_active ? (
            <Archive className="size-3.5" />
          ) : (
            <ArchiveRestore className="size-3.5" />
          )}
        </Button>
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
          placeholder="Naziv polja, npr. ATR na ulazu"
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
              <SelectValue placeholder="Lista" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Napravi novu listu</SelectItem>
              {lists.map((l) => (
                <SelectItem key={l.key} value={l.key}>
                  {l.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button size="sm" className="h-8" onClick={submit} disabled={pending}>
          <Plus className="size-3.5" /> Dodaj polje
        </Button>
      </div>
      {label.trim() && (
        <p className="text-xs text-muted-foreground">
          Ključ:{" "}
          <code className="rounded bg-muted px-1 py-0.5">{key}</code> — trajan je,
          pod njim se čuvaju vrednosti i po njemu se polje zove u izveštajima.
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
        Polja koja sam dodaš. Pojavljuju se na formi u izabranoj grupi i odmah
        postaju dimenzija u izveštajima — bez ijedne izmene koda.
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
                  {inGroup.length} {inGroup.length === 1 ? "polje" : "polja"}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {inGroup.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nema polja u ovoj grupi.
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
