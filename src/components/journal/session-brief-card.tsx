import { Newspaper } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtMoney } from "@/lib/journal/format";
import { flatByFor, type BriefRange, type SessionBrief } from "@/lib/journal/session-brief";
import { fmtInTz } from "@/lib/journal/time";

/** The ranges worth reading before the session, in the order they are traded. */
const RANGES: { key: string; label: string }[] = [
  { key: "NQ_ts", label: "NQ · Topstep dan" },
  { key: "NQ_rth", label: "NQ · RTH" },
  { key: "ES_ts", label: "ES · Topstep dan" },
  { key: "ES_rth", label: "ES · RTH" },
  { key: "6E_ts", label: "6E · Topstep dan" },
];

const whole = (n: number) => Math.round(n).toLocaleString("sr-Latn-RS");

function rangeText(r: BriefRange): string {
  const band = r.ptsLo != null && r.ptsHi != null ? ` (80 %: ${whole(r.ptsLo)}–${whole(r.ptsHi)})` : "";
  return `${whole(r.pts)} ${r.unit}${band}`;
}

/**
 * „Pred sesiju" — what the morning brief says about the day in view: the Topstep
 * end of day, the red windows, the expected range and, on today's page only,
 * what is left of the Daily Loss Limit.
 *
 * Where the check-in card for positions held overnight used to be (G2, H1.3): a
 * day trader has no such position, and this is what the session is decided on.
 * No brief, no invented day — the card says the brief has not arrived and gives
 * the one figure the journal knows without it, the ordinary 15:10 CT close.
 */
export function SessionBriefCard({
  day,
  brief,
  tz,
  dllLeft,
}: {
  day: string;
  brief: SessionBrief | null;
  /** The clock times are shown on — the primary account's. */
  tz: string;
  /** Today's page only: DLL left on the primary Topstep account. */
  dllLeft?: { amount: number; of: number; currency: string } | null;
}) {
  const flat = flatByFor(day, brief);
  const ranges = RANGES.flatMap(({ key, label }) => (brief?.ranges[key] ? [{ label, range: brief.ranges[key] }] : []));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Newspaper className="size-4" /> Pred sesiju
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!brief && (
          <p className="text-muted-foreground">
            Brief za ovaj dan nije stigao u journal — crveni prozori i raspon nisu poznati, pa pravilo o vestima
            danas ne ocenjuje ništa.
          </p>
        )}

        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <span>
            <span className="text-muted-foreground">Kraj dana (ravno): </span>
            {flat.at == null ? (
              <span className="font-medium text-[var(--loss)]">berza zatvorena</span>
            ) : (
              <span className="font-medium">{fmtInTz(flat.at, tz, "HH:mm")}</span>
            )}
            {flat.source === "default" && flat.at != null && (
              <span className="text-xs text-muted-foreground"> (uobičajeno 15:10 CT)</span>
            )}
          </span>
          {dllLeft && (
            <span>
              <span className="text-muted-foreground">DLL danas: </span>
              <span className="font-medium">
                {fmtMoney(dllLeft.amount, dllLeft.currency)} od {fmtMoney(dllLeft.of, dllLeft.currency)}
              </span>
            </span>
          )}
        </div>
        {brief?.dayNote && <p className="text-xs text-[var(--loss)]">{brief.dayNote}</p>}

        {brief && (
          <div>
            <div className="text-xs font-medium text-muted-foreground">Crveni prozori — bez ulaza</div>
            {brief.redWindows.length === 0 ? (
              <p className="text-muted-foreground">Nema važnih vesti.</p>
            ) : (
              <ul className="mt-1 space-y-0.5">
                {brief.redWindows.map((w) => (
                  <li key={`${w.from}-${w.title}`} className="flex gap-2">
                    <span className="font-mono tabular-nums">
                      {fmtInTz(w.from, tz, "HH:mm")}–{fmtInTz(w.to, tz, "HH:mm")}
                    </span>
                    <span>{w.title}</span>
                    {w.impact && <span className="text-xs text-muted-foreground">({w.impact})</span>}
                  </li>
                ))}
              </ul>
            )}
            {brief.droppedWindows > 0 && (
              <p className="mt-1 text-xs text-[var(--loss)]">
                {brief.droppedWindows} prozor(a) iz brief-a nije moglo da se pročita — proveri brief.
              </p>
            )}
          </div>
        )}

        {ranges.length > 0 && (
          <div>
            <div className="text-xs font-medium text-muted-foreground">Očekivani raspon</div>
            <ul className="mt-1 space-y-0.5">
              {ranges.map(({ label, range }) => (
                <li key={label} className="flex justify-between gap-3">
                  <span>{label}</span>
                  <span className="tabular-nums">{rangeText(range)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Vreme: {tz}.
          {brief?.sourceUrl && (
            <>
              {" "}
              <a href={brief.sourceUrl} target="_blank" rel="noreferrer" className="underline">
                Ceo brief
              </a>
            </>
          )}
        </p>
      </CardContent>
    </Card>
  );
}
