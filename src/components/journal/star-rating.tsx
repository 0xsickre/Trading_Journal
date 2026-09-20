"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * An execution rating, five stars.
 *
 * "NOT RATED" IS NOT "1 STAR", and that is the one thing this component has to
 * defend. With no path back to `null`, the first mis-click would stay forever
 * as the lowest rating, and the report would carry a pile of ones nobody meant.
 * So clicking an already-set star clears the rating — the same `TriButton`
 * idiom as `playbook-checklist.tsx`, where a rule's answer has the same three
 * states.
 *
 * A `radiogroup` rather than five checkboxes: the values are mutually
 * exclusive. Each star carries its own numbered `aria-label`, so a screen
 * reader says "3 of 5" instead of five unnamed buttons.
 */
export function StarRating({
  value,
  onChange,
  disabled,
  // The default stays what was hardcoded while this measured execution alone.
  // The same control now carries mental state and the week rating too, so a
  // fixed label would tell a screen reader the wrong thing in two places of
  // three.
  label = "Execution rating",
  // The words, so a screen that is written in another language does not end up
  // with "4 of 5" and "Clear" inside its own prose. Defaults keep every caller
  // that does not pass them exactly as it was.
  texts = {},
}: {
  value: number | null;
  onChange: (next: number | null) => void;
  disabled?: boolean;
  label?: string;
  texts?: {
    valueLabel?: (n: number) => string;
    clear?: string;
    clearHint?: string;
  };
}) {
  const valueLabel = texts.valueLabel ?? ((n: number) => `${n} of 5`);
  const clearLabel = texts.clear ?? "Clear";
  const clearHint = texts.clearHint ?? "Click again to clear";
  // The hover preview. Local state, because nothing outside this component
  // changes until a click.
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value ?? 0;

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex items-center gap-1"
      onMouseLeave={() => setHover(null)}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={valueLabel(n)}
          disabled={disabled}
          // Clicking the set value clears it. In the `title` because it is the
          // one move a user cannot guess by looking.
          title={value === n ? clearHint : valueLabel(n)}
          onMouseEnter={() => setHover(n)}
          onFocus={() => setHover(n)}
          onBlur={() => setHover(null)}
          onClick={() => onChange(value === n ? null : n)}
          className={cn(
            "rounded-sm p-0.5 transition-colors disabled:pointer-events-none disabled:opacity-50",
            n <= shown ? "text-[var(--profit)]" : "text-muted-foreground/40",
          )}
        >
          <Star className={cn("size-5", n <= shown && "fill-current")} />
        </button>
      ))}

      {value != null && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(null)}
          className="ml-1 text-xs text-muted-foreground underline-offset-2 hover:underline disabled:pointer-events-none disabled:opacity-50"
        >
          {clearLabel}
        </button>
      )}
    </div>
  );
}
