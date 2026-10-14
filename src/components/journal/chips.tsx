"use client";

import { cn } from "@/lib/utils";

/** Pick-one-or-many as pills: a short list read at a glance, ticked in a hurry. */
export function Chips({
  items,
  selected,
  onToggle,
  tone = "default",
}: {
  items: { value: string; label: string }[];
  selected: string[];
  onToggle: (v: string) => void;
  tone?: "default" | "loss";
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((it) => {
        const on = selected.includes(it.value);
        return (
          <button
            key={it.value}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(it.value)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs transition-colors",
              on
                ? tone === "loss"
                  ? "border-[var(--loss)] bg-[var(--loss)]/15 text-foreground"
                  : "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-muted-foreground hover:bg-accent",
            )}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
