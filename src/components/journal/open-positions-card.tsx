"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { AlertTriangle, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  THESIS_STATE_LABELS,
  THESIS_STATES,
  TOUCHED_LABELS,
  TOUCHED_STATES,
  type PositionCheckin,
  type ThesisState,
  type TouchedState,
} from "@/lib/journal/position-checkin";
import { savePositionCheckin } from "@/app/(app)/daily/actions";

/**
 * One open position, flattened for the client.
 *
 * The `OpenPosition` from `open-positions.ts` carries the whole `TradeRow`, and
 * a row is a wide object with custom fields on it. Only these seven values cross
 * the boundary — the rest would ship a trade's entire record to the browser to
 * render a heading.
 */
export type OpenPositionView = {
  id: string;
  label: string;
  daysInTrade: number;
  timeStopDays: number | null;
  pastTimeStop: boolean;
  thesis: string | null;
  invalidation: string | null;
  checkin: PositionCheckin | null;
};

/**
 * The daily check, one card per position that was open.
 *
 * At the top of `/daily` on purpose: it is the only part of the page whose
 * answer actually changes from one day to the next while a swing is running.
 * Everything below it — mental temperature, impulses, the tracker checklist —
 * is either a gate checked before entry or a habit scored across the week.
 *
 * TARGET: about sixty seconds for the whole page. Three controls per position,
 * and a new one has to displace an existing one. The research this redesign came
 * from is blunt about the failure mode: journals asking twenty-plus fields a day
 * get abandoned inside a fortnight, and an abandoned journal measures nothing.
 */
export function OpenPositionsCard({
  positions,
  reportDate,
  locked,
}: {
  positions: OpenPositionView[];
  reportDate: string;
  locked: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Open positions
          {positions.length > 0 && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {positions.length}
            </span>
          )}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Did the reason for holding survive today, and did you touch it. Two
          questions per position — the rest of the day is not a swing question.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {positions.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            Nothing was open on this day. There is nothing to check in on.
          </p>
        ) : (
          positions.map((p) => (
            <PositionRow
              key={p.id}
              position={p}
              reportDate={reportDate}
              locked={locked}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}

function PositionRow({
  position,
  reportDate,
  locked,
}: {
  position: OpenPositionView;
  reportDate: string;
  locked: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [thesisState, setThesisState] = useState<ThesisState | null>(
    position.checkin?.thesis_state ?? null,
  );
  const [touched, setTouched] = useState<TouchedState | null>(
    position.checkin?.touched ?? null,
  );
  const [note, setNote] = useState(position.checkin?.note ?? "");
  const [savedNote, setSavedNote] = useState(position.checkin?.note ?? "");

  /**
   * Persists immediately on every answer, like the tracker checklist.
   *
   * Takes the FULL row rather than a patch. The upsert writes all three columns,
   * so a partial payload would blank the two the user did not just touch — and
   * every caller has to pass the new value explicitly anyway, because a
   * `setState` in the same event has not applied yet and reading the hook here
   * would save one tap behind.
   */
  function persist(row: {
    thesis_state: ThesisState | null;
    touched: TouchedState | null;
    note: string | null;
  }) {
    start(async () => {
      const res = await savePositionCheckin(reportDate, {
        position_id: position.id,
        ...row,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      router.refresh();
    });
  }

  function pickThesis(v: ThesisState) {
    // Tapping the selected answer clears it. "I have not judged this today" is a
    // different statement from "the thesis is intact", and without a way back to
    // it a mis-tap becomes a permanent opinion.
    const next = thesisState === v ? null : v;
    setThesisState(next);
    persist({ thesis_state: next, touched, note: note || null });
  }

  function pickTouched(v: TouchedState) {
    const next = touched === v ? null : v;
    setTouched(next);
    persist({ thesis_state: thesisState, touched: next, note: note || null });
  }

  function saveNote() {
    if (note === savedNote) return;
    setSavedNote(note);
    persist({ thesis_state: thesisState, touched, note: note || null });
  }

  const answered = thesisState != null;

  return (
    <div
      className={cn(
        "space-y-3 rounded-lg border p-4",
        position.pastTimeStop && "border-amber-500/60",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/trades/${position.id}`}
            className="font-medium hover:underline"
          >
            {position.label}
          </Link>
          <span className="text-sm text-muted-foreground">
            day {position.daysInTrade}
            {position.timeStopDays != null && ` of ${position.timeStopDays}`}
          </span>
          {answered && (
            <Check className="size-4 text-muted-foreground" aria-label="Checked in" />
          )}
        </div>
        {position.pastTimeStop && (
          <Badge variant="outline" className="gap-1 border-amber-500/60">
            <AlertTriangle className="size-3" />
            Past time stop
          </Badge>
        )}
      </div>

      {/* Read-only, straight off the trade. It is here so the thesis is in front
          of you when you judge it — judging a hold from memory is how a position
          quietly turns into a different trade than the one you took. */}
      {(position.thesis || position.invalidation) && (
        <dl className="space-y-1 rounded-md bg-muted/40 p-3 text-sm">
          {position.thesis && (
            <div className="flex gap-2">
              <dt className="shrink-0 text-muted-foreground">Thesis</dt>
              <dd>{position.thesis}</dd>
            </div>
          )}
          {position.invalidation && (
            <div className="flex gap-2">
              <dt className="shrink-0 text-muted-foreground">Invalidated if</dt>
              <dd>{position.invalidation}</dd>
            </div>
          )}
        </dl>
      )}

      <div className="space-y-2">
        <Label>Thesis today</Label>
        <div className="flex flex-wrap gap-2">
          {THESIS_STATES.map((s) => (
            <Button
              key={s}
              type="button"
              size="sm"
              disabled={locked || pending}
              variant={
                thesisState === s
                  ? s === "invalidated"
                    ? "destructive"
                    : "default"
                  : "outline"
              }
              onClick={() => pickThesis(s)}
            >
              {THESIS_STATE_LABELS[s]}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Touched it</Label>
        <div className="flex flex-wrap gap-2">
          {TOUCHED_STATES.map((s) => (
            <Button
              key={s}
              type="button"
              size="sm"
              disabled={locked || pending}
              variant={touched === s ? "default" : "outline"}
              onClick={() => pickTouched(s)}
            >
              {TOUCHED_LABELS[s]}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`note-${position.id}`}>Note (optional)</Label>
        <Textarea
          id={`note-${position.id}`}
          value={note}
          disabled={locked}
          onChange={(e) => setNote(e.target.value)}
          // Saved on blur rather than per keystroke: a request per character is
          // a request per character, and a note is finished when you leave it.
          onBlur={saveNote}
          rows={2}
        />
      </div>
    </div>
  );
}
