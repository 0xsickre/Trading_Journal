"use client";

import { useMemo, useRef, useState } from "react";
import { Check, X } from "lucide-react";
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
import type { Instrument } from "@/lib/journal/types";
import { cn } from "@/lib/utils";

/**
 * Pick an instrument by typing it.
 *
 * This was a grouped `Select` over the whole catalog — ninety-odd symbols,
 * every one of them rendered, and finding XAUUSD meant scrolling past all of
 * Forex. Radix carries type-to-jump, but it matches the START of a label, so a
 * trader who thinks "gold" rather than "XAUUSD" had nothing to type.
 *
 * Typing here filters on symbol, name AND asset class, so "gold", "xau" and
 * "nas" all land. The class grouping survives for the unfiltered list, because
 * that is what makes ninety entries readable when nothing is typed, and drops
 * to the groups that still hold a match once something is.
 *
 * The shape is `TagMultiSelect`'s, deliberately: an input with the chosen value
 * above it, a popover anchored to the input, and the same `onFocusOutside`
 * guard. Two pickers in one form that behave differently is a cost paid by the
 * person using them.
 */

/**
 * Instruments by class, in catalog order.
 *
 * `sort_order` is already grouped into ranges (Forex 0–120, CFD 200–312,
 * futures 400+), so it is enough to keep the order they arrive in from
 * `getInstruments` and group the adjacent ones. A custom instrument the user
 * adds without a class falls into "Other" instead of vanishing from the list.
 */
function groupByAssetClass(instruments: Instrument[]): [string, Instrument[]][] {
  const groups = new Map<string, Instrument[]>();
  for (const i of instruments) {
    const key = i.asset_class?.trim() || "Other";
    const arr = groups.get(key);
    if (arr) arr.push(i);
    else groups.set(key, [i]);
  }
  return [...groups.entries()];
}

export function InstrumentSelect({
  instruments,
  value,
  onChange,
  disabled,
}: {
  instruments: Instrument[];
  value: string;
  onChange: (symbol: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = instruments.find((i) => i.symbol === value) ?? null;

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q
      ? instruments.filter(
          (i) =>
            i.symbol.toLowerCase().includes(q) ||
            (i.name ?? "").toLowerCase().includes(q) ||
            (i.asset_class ?? "").toLowerCase().includes(q),
        )
      : instruments;
    return groupByAssetClass(matches);
  }, [instruments, query]);

  const flat = useMemo(() => groups.flatMap(([, list]) => list), [groups]);

  function pick(symbol: string) {
    onChange(symbol);
    setQuery("");
    setOpen(false);
  }

  return (
    <div className="space-y-2">
      {/*
        The chosen instrument, shown whether or not the field has focus. A trade
        form has to say what is ON the trade; a placeholder that reappears the
        moment the input is cleared says nothing.
      */}
      {value && (
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="secondary" className="gap-1 pr-1 font-normal">
            {selected ? `${selected.symbol}${selected.name ? ` — ${selected.name}` : ""}` : value}
            {!disabled && (
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
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                // One match left and Enter takes it — the point of typing.
                e.preventDefault();
                if (flat.length === 1) pick(flat[0].symbol);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setQuery("");
                setOpen(false);
              }
            }}
            placeholder={value ? "Change instrument…" : "Type a symbol or a name…"}
            disabled={disabled}
            className="w-full"
            autoComplete="off"
          />
        </PopoverAnchor>
        <PopoverContent
          className="w-[var(--radix-popover-trigger-width)] p-0"
          align="start"
          onOpenAutoFocus={(e) => e.preventDefault()}
          // The input is the popover's ANCHOR and sits outside its content, so
          // focus returning to it reads as focus leaving the popover — the same
          // trap `TagMultiSelect` documents. Pointer and Escape paths are
          // unaffected and still close the list.
          onFocusOutside={(e) => e.preventDefault()}
        >
          <Command shouldFilter={false}>
            <CommandList className="max-h-72">
              {flat.length === 0 && (
                <CommandEmpty>Nothing matches “{query.trim()}”</CommandEmpty>
              )}
              {groups.map(([cls, list]) => (
                <CommandGroup key={cls} heading={cls}>
                  {list.map((i) => (
                    <CommandItem
                      key={i.id}
                      value={i.symbol}
                      onSelect={() => pick(i.symbol)}
                    >
                      {/* Always rendered, visible only when chosen: an icon that
                          appears and disappears shifts every label beside it. */}
                      <Check
                        className={cn(
                          "mr-2 size-4 shrink-0",
                          i.symbol === value ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span className="font-medium">{i.symbol}</span>
                      {i.name && (
                        <span className="ml-2 truncate text-muted-foreground">{i.name}</span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
