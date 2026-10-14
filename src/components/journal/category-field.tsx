"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EditableSelect } from "@/components/journal/editable-select";
import { TagMultiSelect } from "@/components/journal/tag-multi-select";
import { MERGED_CATEGORY_LISTS } from "@/lib/journal/column-backed-fields";
import type { FieldDef } from "@/lib/journal/field-def-types";
import type { OptionsMap } from "@/lib/journal/types";
import { cn } from "@/lib/utils";

export type CategoryValue = string | string[] | null;

/**
 * One of the trader's own categories on the trade page (phase P), drawn from its
 * definition in `tj_field_defs` — a category added in Settings shows up here
 * without code. A list-backed category takes the full row; the list is the same
 * one Settings edits, and a value typed here is added to it.
 */
export function CategoryField({
  def,
  value,
  onChange,
  optionsMap,
}: {
  def: FieldDef;
  value: CategoryValue;
  onChange: (v: CategoryValue) => void;
  optionsMap: OptionsMap;
}) {
  const id = `cat-${def.key}`;
  const wide = def.field_type === "tags" || def.field_type === "textarea" || def.field_type === "select";
  return (
    <div className={cn("space-y-1.5", wide && "sm:col-span-2")}>
      <Label htmlFor={id} className="text-xs">
        {def.label}
      </Label>
      {def.field_type === "tags" ? (
        <TagMultiSelect
          value={Array.isArray(value) ? value : []}
          onChange={(v) => onChange(v)}
          optionsMap={optionsMap}
          listKey={def.list_key ?? undefined}
          listKeys={MERGED_CATEGORY_LISTS[def.key] ? [...MERGED_CATEGORY_LISTS[def.key]] : undefined}
        />
      ) : def.field_type === "select" && def.list_key ? (
        <EditableSelect
          listKey={def.list_key}
          options={optionsMap[def.list_key] ?? []}
          value={typeof value === "string" ? value : ""}
          onChange={(v) => onChange(v || null)}
        />
      ) : def.field_type === "textarea" ? (
        <Textarea
          id={id}
          rows={2}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <Input
          id={id}
          type={def.field_type === "url" ? "url" : "text"}
          inputMode={def.field_type === "number" ? "decimal" : undefined}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}
