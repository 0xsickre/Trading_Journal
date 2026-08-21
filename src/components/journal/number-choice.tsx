"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Izbor jednog broja iz kratkog raspona, klikom.
 *
 * ZAŠTO NE `StarRating`. Zvezdice su monotone — `n <= izabrano` se popunjava,
 * pa tri pune zvezdice čitaju kao „tri od pet dobrote". To je tačno za ocenu i
 * pogrešno za količinu: „3 dana" nije bolje ni gore od „5 dana", to je drugi
 * broj. Zato se ovde iscrtavaju CIFRE i boji se samo izabrana.
 *
 * „NIJE UPISANO" NIJE „1", i to je jedina stvar koju ova komponenta mora da
 * odbrani. Klik na već izabran broj ga briše nazad na `null` — isti idiom kao
 * `StarRating` i `TriButton` u `playbook-checklist.tsx`. Bez puta nazad, prvi
 * promašen klik bi zauvek ostao kao vrednost koju niko nije mislio.
 *
 * `radiogroup` a ne dugmad bez uloge: vrednosti se međusobno isključuju, pa
 * čitač ekrana treba da ih čuje kao jedan izbor, ne kao pet nezavisnih akcija.
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
            // U `title` jer je to jedini potez koji se ne može pogoditi gledajući.
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
