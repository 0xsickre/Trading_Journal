"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  MIN_SAMPLE,
  RELIABLE_SAMPLE,
  type SickreScore,
} from "@/lib/journal/sickre-score";

/**
 * Composite score with its components exposed.
 *
 * The breakdown is shown rather than just the headline number: a single 0–100
 * figure invites you to chase the number, while the component list says which
 * input is dragging and is therefore actionable. Components that could not be
 * computed are shown as dropped, not as zero — a book with no drawdown yet
 * should not be scored as if it had a terrible one.
 */
export function SickreScoreCard({ score }: { score: SickreScore }) {
  const value = score.score;
  const { confidence } = score;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Sickre Score</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-baseline gap-3">
          <span
            className={`text-4xl font-semibold tabular-nums ${scoreClass(value)}`}
          >
            {value == null ? "—" : Math.round(value)}
          </span>
          <span className="text-sm text-muted-foreground">/ 100</span>
          {/* The sample rides next to the number, not in a tooltip. A score off
              twelve trades is a real score and an unstable one, and the reader
              can only know which if the n is on screen with it. */}
          {confidence.level === "provisional" && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              privremeno · {confidence.trades}{" "}
              {confidence.trades === 1 ? "trejd" : "trejda"}
            </span>
          )}
          {/* Against maxCoverage, not 100: the total is 115 once the process
              component is supplied, so a hardcoded 100 would render a partial
              score as fully covered. */}
          {score.coverage > 0 && score.coverage < score.maxCoverage && (
            <span className="ml-auto text-xs text-muted-foreground">
              {Math.round((score.coverage / score.maxCoverage) * 100)}% pondera pokriveno
            </span>
          )}
        </div>

        <div className="space-y-2">
          {score.components.map((c) => (
            <div key={c.key} className="flex items-center gap-3 text-sm">
              <span className="w-36 shrink-0 text-muted-foreground">
                {c.label}
              </span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                {c.counted && c.score != null && (
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.max(0, Math.min(100, c.score))}%` }}
                  />
                )}
              </div>
              <span className="w-10 shrink-0 text-right tabular-nums">
                {c.counted && c.score != null ? Math.round(c.score) : "—"}
              </span>
              <span className="w-9 shrink-0 text-right text-xs text-muted-foreground">
                {c.weight}%
              </span>
            </div>
          ))}
        </div>

        {confidence.level === "withheld" ? (
          // Said outright. A bare "—" over seven dashes reads as a broken card
          // rather than as an account with no history yet, and the countdown is
          // the one thing the trader can act on.
          <p className="text-xs text-muted-foreground">
            {confidence.reason === "sample" ? (
              <>
                Skor još ne postoji — treba{" "}
                <strong>
                  još {confidence.tradesShort}{" "}
                  {confidence.tradesShort === 1 ? "zatvoren trejd" : "zatvorena trejda"}
                </strong>
                . Ispod {MIN_SAMPLE} trejda svaka komponenta je artefakt uzorka:
                jedan dobitnik daje beskonačan profit factor, nula drawdown-a i
                100 % win rate — četiri maksimuma koji ne znače ništa.
              </>
            ) : (
              <>
                Skor se ne prikazuje jer je pokriveno manje od pola pondera.
                Ono što se meri je prikazano dole po komponentama — ali jedna
                komponenta pod imenom kompozita nije kompozit.
              </>
            )}
          </p>
        ) : (
          score.components.some((c) => !c.counted) && (
            <p className="text-xs text-muted-foreground">
              Komponente bez podataka su izbačene, a preostali ponderi
              renormalizovani — mlad track record se ne kažnjava za račun koji
              nema šta da podeli.
            </p>
          )
        )}

        {confidence.level === "provisional" && (
          <p className="text-xs text-muted-foreground">
            Uzorak je još mali, pa će skor osetno skakati sa svakim trejdom.
            Stabilizuje se oko {RELIABLE_SAMPLE} zatvorenih trejdova.
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          Max drawdown komponenta deli pad vrhom <strong>kumulativnog P&amp;L-a</strong>,
          ne equity-jem prikazanim gore. Dva različita imenioca — ovaj je izabran
          da skor ostane uporediv sa istom metrikom kod drugih alata.
        </p>
      </CardContent>
    </Card>
  );
}

function scoreClass(v: number | null): string {
  if (v == null) return "text-muted-foreground";
  if (v >= 70) return "text-[var(--profit)]";
  if (v >= 40) return "";
  return "text-[var(--loss)]";
}

