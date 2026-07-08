"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import {
  Popover,
  PopoverContent,
  PopoverAnchor,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { addOption } from "@/app/(app)/settings/actions";
import type { OptionItem, OptionsMap } from "@/lib/journal/types";
import { cn } from "@/lib/utils";

type Props = {
  value: string[];
  onChange: (value: string[]) => void;
  optionsMap: OptionsMap;
  listKey?: string;
  listKeys?: string[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
};

function mergeOptions(
  optionsMap: OptionsMap,
  listKey?: string,
  listKeys?: string[],
): OptionItem[] {
  const keys = listKeys?.length ? listKeys : listKey ? [listKey] : [];
  const seen = new Set<string>();
  const out: OptionItem[] = [];
  for (const k of keys) {
    for (const opt of optionsMap[k] ?? []) {
      if (seen.has(opt.value)) continue;
      seen.add(opt.value);
      out.push(opt);
    }
  }
  return out.sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label));
}

export function TagMultiSelect({
  value,
  onChange,
  optionsMap,
  listKey,
  listKeys,
  placeholder = "Type to search or add…",
  disabled,
  className,
}: Props) {
  const addTargetKey = listKey ?? listKeys?.[0] ?? "";
  const baseOptions = useMemo(
    () => mergeOptions(optionsMap, listKey, listKeys),
    [optionsMap, listKey, listKeys],
  );
  const [items, setItems] = useState<OptionItem[]>(baseOptions);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setItems(baseOptions);
  }, [baseOptions]);

  const selected = value ?? [];
  const available = items.filter((o) => !selected.includes(o.value));
  const q = query.trim().toLowerCase();
  const filtered = q
    ? available.filter(
        (o) =>
          o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
      )
    : available;

  const exactMatch = available.find(
    (o) => o.label.toLowerCase() === q || o.value.toLowerCase() === q,
  );
  const canCreate = q.length > 0 && !exactMatch && !selected.some((t) => t.toLowerCase() === q);

  function addTag(tag: string) {
    const t = tag.trim();
    if (!t || selected.includes(t)) return;
    onChange([...selected, t]);
    setQuery("");
    setOpen(false);
  }

  function removeTag(tag: string) {
    onChange(selected.filter((t) => t !== tag));
  }

  function selectOption(opt: OptionItem) {
    addTag(opt.value);
    inputRef.current?.focus();
  }

  function createTag(label: string) {
    const trimmed = label.trim();
    if (!trimmed) return;

    if (exactMatch) {
      addTag(exactMatch.value);
      return;
    }

    const existing = items.find(
      (o) => o.label.toLowerCase() === trimmed.toLowerCase() || o.value.toLowerCase() === trimmed.toLowerCase(),
    );
    if (existing) {
      addTag(existing.value);
      return;
    }

    if (!addTargetKey) {
      addTag(trimmed);
      return;
    }

    startTransition(async () => {
      const res = await addOption(addTargetKey, trimmed);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setItems((prev) =>
        prev.some((i) => i.value === res.item.value) ? prev : [...prev, res.item],
      );
      addTag(res.item.value);
      toast.success(`Added “${res.item.label}”`);
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (exactMatch) {
        addTag(exactMatch.value);
      } else if (canCreate) {
        createTag(query);
      } else if (filtered.length === 1) {
        addTag(filtered[0]!.value);
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setQuery("");
      return;
    }
    if (e.key === "Backspace" && query === "" && selected.length > 0) {
      removeTag(selected[selected.length - 1]!);
    }
  }

  return (
    <div className={cn("space-y-2", className)}>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((tag) => (
            <Badge key={tag} variant="secondary" className="gap-1 pr-1 font-normal">
              {tag}
              {!disabled && (
                <button
                  type="button"
                  className="rounded-sm hover:bg-muted"
                  onClick={() => removeTag(tag)}
                  title="Remove"
                >
                  <X className="size-3" />
                </button>
              )}
            </Badge>
          ))}
        </div>
      )}

      <Popover open={open && !disabled} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled || pending}
            className="w-full"
            autoComplete="off"
          />
        </PopoverAnchor>
        <PopoverContent
          className="w-[var(--radix-popover-trigger-width)] p-0"
          align="start"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <Command shouldFilter={false}>
            <CommandList>
              {filtered.length === 0 && !canCreate && (
                <CommandEmpty>No matches</CommandEmpty>
              )}
              {filtered.length > 0 && (
                <CommandGroup>
                  {filtered.map((opt) => (
                    <CommandItem
                      key={opt.id}
                      value={opt.value}
                      onSelect={() => selectOption(opt)}
                    >
                      {opt.label}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {canCreate && (
                <CommandGroup>
                  <CommandItem
                    value={`__create__${query}`}
                    onSelect={() => createTag(query)}
                  >
                    {pending ? "Adding…" : `Add “${query.trim()}”`}
                  </CommandItem>
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
