"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Ocena izvršenja, pet zvezdica.
 *
 * „NIJE OCENJENO" NIJE „1 ZVEZDICA", i to je jedina stvar koju ova komponenta
 * mora da odbrani. Bez puta nazad do `null`, prvi promašen klik bi zauvek
 * ostao kao najniža ocena, a izveštaj bi imao gomilu jedinica koje niko nije
 * mislio. Zato klik na već postavljenu zvezdicu briše ocenu — isti `TriButton`
 * idiom iz `playbook-checklist.tsx`, gde odgovor na pravilo ima ista tri stanja.
 *
 * `radiogroup` a ne pet checkbox-ova: vrednosti se isključuju. Svaka zvezdica
 * nosi svoj `aria-label` sa brojem, pa čitač ekrana čita „3 of 5" umesto pet
 * bezimenih dugmadi.
 */
export function StarRating({
  value,
  onChange,
  disabled,
  // Podrazumevano ostaje ono što je bilo tvrdo kodirano dok je ovo merilo samo
  // izvršenje. Sad isto merilo nosi i mentalno stanje i ocenu nedelje, pa bi
  // fiksna oznaka čitaču ekrana javljala pogrešnu stvar na dva od tri mesta.
  label = "Execution rating",
}: {
  value: number | null;
  onChange: (next: number | null) => void;
  disabled?: boolean;
  label?: string;
}) {
  // Pregled pri prelasku mišem. Lokalno stanje, jer se ništa izvan ove
  // komponente ne menja dok se ne klikne.
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
          aria-label={`${n} of 5`}
          disabled={disabled}
          // Klik na postavljenu vrednost je poništava. U `title` jer je to
          // jedina poteza koju korisnik ne može da pogodi gledajući.
          title={value === n ? "Click again to clear" : `${n} of 5`}
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
          Clear
        </button>
      )}
    </div>
  );
}
