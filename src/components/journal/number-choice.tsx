"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Picking one number out of a short range, by clicking.
 *
 * WHY NOT `StarRating`. Stars are monotonic — everything `n <= selected` fills
 * in, so three filled stars read as "three out of five of goodness". That is
 * right for a rating and wrong for a quantity: "3 days" is neither better nor
 * worse than "5 days", it is a different number. So this draws DIGITS and
 * colours only the selected one.
 *
 * "NOT RECORDED" IS NOT "1", and that is the one thing this component has to
 * defend. Clicking an already-selected number clears it back to `null` — the
 * same idiom as `StarRating` and `TriButton` in `playbook-checklist.tsx`. With
 * no path back, the first mis-click would stay forever as a value nobody meant.
 *
 * A `radiogroup` rather than buttons with no role: the values are mutually
 * exclusive, so a screen reader should hear them as one choice, not as five
 * independent actions.
 */
export function NumberChoice({
  value,
  onChange,
  min = 1,
  max = 5,
  label,
  disabled,
}: {
  value: number | null;
  onChange: (next: number | null) => void;
  min?: number;
  max?: number;
  label: string;
  disabled?: boolean;
}) {
  const options: number[] = [];
  for (let n = min; n <= max; n++) options.push(n);

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex w-fit rounded-md border p-0.5"
    >
      {options.map((n) => {
        const active = value === n;
        return (
          <Button
            key={n}
            type="button"
            role="radio"
            aria-checked={active}
            variant="ghost"
            size="sm"
            disabled={disabled}
            // In the `title` because it is the one move that cannot be guessed by looking.
            title={active ? "Click again to clear" : undefined}
            onClick={() => onChange(active ? null : n)}
            className={cn(
              "h-7 w-9 px-0 tabular-nums",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground",
            )}
          >
            {n}
          </Button>
        );
      })}
    </div>
  );
}
