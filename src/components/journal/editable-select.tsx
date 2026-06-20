"use client";

import { useEffect, useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addOption } from "@/app/(app)/settings/actions";
import type { OptionItem } from "@/lib/journal/types";
import { cn } from "@/lib/utils";

type Props = {
  listKey: string;
  options: OptionItem[];
  value: string | null | undefined;
  onChange: (value: string) => void;
  placeholder?: string;
  allowAdd?: boolean;
  allowClear?: boolean;
  disabled?: boolean;
  className?: string;
};

export function EditableSelect({
  listKey,
  options,
  value,
  onChange,
  placeholder = "Select…",
  allowAdd = true,
  allowClear = true,
  disabled,
  className,
}: Props) {
  const [items, setItems] = useState<OptionItem[]>(options);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();

  // Keep local list in sync when server re-supplies options.
  useEffect(() => {
    setItems(options);
  }, [options]);

  // If the current value refers to a soft-deleted/archived option not present
  // in the active list, surface it so the selection stays visible.
  const hasValue = value != null && value !== "";
  const valueMissing = hasValue && !items.some((i) => i.value === value);
  const renderItems = valueMissing
    ? [
        ...items,
        {
          id: `__archived_${value}`,
          value: value as string,
          label: `${value} (archived)`,
          color: null,
          is_active: false,
          sort_order: 9999,
        },
      ]
    : items;

  function handleAdd() {
    const label = draft.trim();
    if (!label) return;
    startTransition(async () => {
      const res = await addOption(listKey, label);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setItems((prev) =>
        prev.some((i) => i.value === res.item.value)
          ? prev
          : [...prev, res.item],
      );
      onChange(res.item.value);
      setDraft("");
      setOpen(false);
      toast.success(`Added “${res.item.label}”`);
    });
  }

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Select
        value={hasValue ? (value as string) : undefined}
        onValueChange={onChange}
        disabled={disabled}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {renderItems.map((opt) => (
            <SelectItem key={opt.id} value={opt.value}>
              <span className="flex items-center gap-2">
                {opt.color && (
                  <span
                    className="inline-block size-2.5 rounded-full"
                    style={{ backgroundColor: opt.color }}
                  />
                )}
                {opt.label}
              </span>
            </SelectItem>
          ))}
          {renderItems.length === 0 && (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">
              No options yet
            </div>
          )}
        </SelectContent>
      </Select>

      {allowClear && hasValue && !disabled && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-9 shrink-0 text-muted-foreground"
          onClick={() => onChange("")}
          title="Clear"
        >
          <X className="size-4" />
        </Button>
      )}

      {allowAdd && !disabled && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-9 shrink-0"
              title="Add new option"
            >
              <Plus className="size-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64" align="end">
            <div className="space-y-2">
              <p className="text-sm font-medium">Add new option</p>
              <Input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="e.g. New emotion"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAdd();
                  }
                }}
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleAdd}
                  disabled={pending || !draft.trim()}
                >
                  {pending ? "Adding…" : "Add"}
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
