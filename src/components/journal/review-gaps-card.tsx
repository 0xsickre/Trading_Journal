import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ReviewGap } from "@/lib/journal/review-gaps";

const MISSING = {
  setup: "setup",
  grade: "ocena",
  stop: "stop",
  original_stop: "originalni stop (pomeren — sa snimka)",
} as const;

/**
 * The day's trades still missing a setup, a grade or their stop — the ones that
 * came in through the export. Each opens the short review, not the full form.
 * Nothing to show, nothing rendered: a finished day needs no card.
 */
export function ReviewGapsCard({ gaps }: { gaps: ReviewGap[] }) {
  if (gaps.length === 0) return null;
  return (
    <Card className="border-[var(--loss)]/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardList className="size-4" /> Bez pregleda ({gaps.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5 text-sm">
        <p className="text-xs text-muted-foreground">
          Setup, ocena A/B/C i stop sa snimka — na tome stoji mentor pack. Pomeren stop: upiši originalni.
        </p>
        {gaps.map((g) => (
          <div key={g.id} className="flex items-center justify-between gap-3">
            <span>
              {g.label} <span className="text-xs text-muted-foreground">— fali {g.missing.map((m) => MISSING[m]).join(" i ")}</span>
            </span>
            <Link href={`/trades/${g.id}/review`} className="text-xs underline">
              Pregledaj
            </Link>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
