"use client";

import { useRef, useState, useTransition } from "react";
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

/**
 * One value from an option list — typed, not picked from a menu.
 *
 * The SINGLE-VALUE TWIN OF `TagMultiSelect`, and deliberately identical to it
 * on screen: the chosen value sits above as a chip, the box below filters the
 * list as you type, and Enter takes the match or writes a new option straight
 * into the list.
 *
 * It used to be a `Select` trigger with a `+` button beside it that opened a
 * popover with its own input and its own Add button — so every option list on
 * the trade form looked like one of two different controls depending on whether
 * it happened to be single- or multi-valued, and adding a value cost three
 * clicks in one and a keystroke in the other. They are all the same thing to
 * the person filling the form: a list of tags they own. Now they read and
 * behave the same, and the only difference left is how many values stick.
 */
export function EditableSelect({
  listKey,
  options,
  value,
  onChange,
  placeholder = "Type to search or add…",
  allowAdd = true,
  allowClear = true,
  disabled,
  className,
}: Props) {
  const [items, setItems] = useState<OptionItem[]>(options);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep local list in sync when server re-supplies options (adjust-during-render
  // pattern — avoids a prop→state sync effect).
  const [prevOptions, setPrevOptions] = useState(options);
  if (options !== prevOptions) {
    setPrevOptions(options);
    setItems(options);
  }

  const hasValue = value != null && value !== "";
  // A value the active list no longer offers is still the value this trade was
  // recorded with — it keeps its chip, labelled, rather than vanishing.
  const archived = hasValue && !items.some((i) => i.value === value);
  const label =
    items.find((i) => i.value === value)?.label ?? (value as string) ?? "";

  const available = items.filter((o) => o.value !== value);
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
  const canCreate = allowAdd && q.length > 0 && !exactMatch;

  function pick(next: string) {
    onChange(next);
    setQuery("");
    setOpen(false);
  }

  function create(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;

    // Typing the name of something that already exists selects it rather than
    // creating a duplicate — including one that differs only in case.
    const existing = items.find(
      (o) =>
        o.label.toLowerCase() === trimmed.toLowerCase() ||
        o.value.toLowerCase() === trimmed.toLowerCase(),
    );
    if (existing) {
      pick(existing.value);
      return;
    }

    startTransition(async () => {
      const res = await addOption(listKey, trimmed);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setItems((prev) =>
        prev.some((i) => i.value === res.item.value) ? prev : [...prev, res.item],
      );
      pick(res.item.value);
      toast.success(`Added “${res.item.label}”`);
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (exactMatch) pick(exactMatch.value);
      else if (canCreate) create(query);
      else if (filtered.length === 1) pick(filtered[0]!.value);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setQuery("");
      return;
    }
    // Same reach as the multi-select's: an empty box and one more Backspace
    // takes the value off.
    if (e.key === "Backspace" && query === "" && hasValue && allowClear) {
      onChange("");
    }
  }

  return (
    <div className={cn("space-y-2", className)}>
      {hasValue && (
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="secondary" className="gap-1 pr-1 font-normal">
            {label}
            {archived && (
              <span className="text-muted-foreground">(archived)</span>
            )}
            {allowClear && !disabled && (
              <button
                type="button"
                className="rounded-sm hover:bg-muted"
                onClick={() => onChange("")}
                title="Clear"
              >
                <X className="size-3" />
              </button>
            )}
          </Badge>
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
                      onSelect={() => {
                        pick(opt.value);
                        inputRef.current?.focus();
                      }}
                    >
                      <span className="flex items-center gap-2">
                        {opt.color && (
                          <span
                            className="inline-block size-2.5 rounded-full"
                            style={{ backgroundColor: opt.color }}
                          />
                        )}
                        {opt.label}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {canCreate && (
                <CommandGroup>
                  <CommandItem
                    value={`__create__${query}`}
                    onSelect={() => create(query)}
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
