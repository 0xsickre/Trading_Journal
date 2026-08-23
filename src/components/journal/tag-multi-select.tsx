"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Check, X } from "lucide-react";
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

  // Resync local list when the server re-supplies options (adjust-during-render
  // pattern — avoids a prop→state sync effect).
  const [prevBase, setPrevBase] = useState(baseOptions);
  if (baseOptions !== prevBase) {
    setPrevBase(baseOptions);
    setItems(baseOptions);
  }

  const selected = value ?? [];
  /**
   * EVERY option, chosen or not.
   *
   * The chosen ones used to be filtered out, which is what a picker that closes
   * on each pick wants — you never see the list again to notice they are gone.
   * A list that stays open has to show the whole set with the chosen ones
   * TICKED, or the trader cannot tell what is already on the trade, cannot
   * un-tick from here, and watches rows silently vanish as they click.
   */
  const available = items;
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

  /**
   * Add a tag and close, for the paths that finish a thought: typing a name and
   * pressing Enter, or creating one that did not exist.
   */
  function addTag(tag: string) {
    const t = tag.trim();
    if (!t || selected.includes(t)) return;
    onChange([...selected, t]);
    setQuery("");
    setOpen(false);
  }

  /**
   * Ticking an option in the open list — add or remove, and STAY OPEN.
   *
   * This is the whole difference between a multi-select and a single one, and
   * the list used to close on every pick like a single-select. Choosing three
   * tags meant opening the same list three times, and nothing on screen said
   * which were already chosen once it was open: picking one that was already on
   * the trade did nothing at all, silently.
   *
   * So it toggles, and every row carries a tick. The query is cleared because
   * the filter has done its job, and focus goes back to the input so typing
   * narrows the list again without a click.
   */
  function toggleOption(opt: OptionItem) {
    const t = opt.value.trim();
    if (!t) return;
    onChange(
      selected.includes(t) ? selected.filter((x) => x !== t) : [...selected, t],
    );
    setQuery("");
    inputRef.current?.focus();
  }

  function removeTag(tag: string) {
    onChange(selected.filter((t) => t !== tag));
  }

  function selectOption(opt: OptionItem) {
    toggleOption(opt);
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
          // Ticking a row puts focus back on the input so typing keeps
          // narrowing the list — but the input is the popover's ANCHOR, which
          // sits outside its content, so Radix read that as focus leaving and
          // closed the list on every tick. It closes on a click outside or on
          // Escape, both of which are pointer/key paths and unaffected.
          onFocusOutside={(e) => e.preventDefault()}
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
                      {/* Always rendered, visible only when chosen: an icon
                          that appears and disappears would shift every label
                          beside it as the list is ticked through. */}
                      <Check
                        className={cn(
                          "mr-2 size-4 shrink-0",
                          selected.includes(opt.value)
                            ? "opacity-100"
                            : "opacity-0",
                        )}
                      />
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
