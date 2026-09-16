"use client";

import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { computePlannedRewardR } from "@/lib/journal/plan-calculations";
import {
  MAX_SCALE_OUT_PCT,
  totalScaleOutPct,
  type ScaleOutRow,
} from "@/lib/journal/scale-out";
import { cn } from "@/lib/utils";

/**
 * How much of the position comes off, and at what price.
 *
 * A trade carries ONE `target_price` — that is a day trader's exit: one level,
 * one fill, done. A position held for days usually comes off in pieces, and
 * until now that was not expressible anywhere except in a sentence.
 *
 * The R column is DERIVED and read-only. A price is entered, because every
 * other level on this screen is a price; R is computed by the existing
 * `computePlannedRewardR` from entry and stop. Had R been stored, a changed
 * stop would silently make the stored number untrue.
 *
 * The total is always shown, and turns red above 100 %. The display itself
 * does not block — `submit()` in the form does — but the figure has to be on
 * screen before "Update" is clicked, or the error is only learned through a
 * toast.
 */
export function ScaleOutEditor({
  rows,
  onChange,
  direction,
  entry,
  stop,
}: {
  rows: ScaleOutRow[];
  onChange: (rows: ScaleOutRow[]) => void;
  direction: string | null;
  entry: number | null;
  stop: number | null;
}) {
  const total = totalScaleOutPct(rows);
  const over = total > MAX_SCALE_OUT_PCT;

  const set = (i: number, patch: Partial<ScaleOutRow>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-2 sm:col-span-2">
      <Label className="text-xs">Scale-out levels</Label>

      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No levels yet — the whole position comes off at the target.
        </p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r, i) => {
            const price = r.price.trim() === "" ? null : Number(r.price);
            const rr =
              price != null && Number.isFinite(price)
                ? computePlannedRewardR({ direction, entry, stop, target: price })
                : null;
            return (
              <div key={i} className="grid grid-cols-12 items-center gap-2">
                <div className="col-span-3">
                  <Input
                    className="h-8"
                    inputMode="decimal"
                    placeholder="%"
                    value={r.pct}
                    onChange={(e) => set(i, { pct: e.target.value })}
                  />
                </div>
                <div className="col-span-5">
                  <Input
                    className="h-8"
                    inputMode="decimal"
                    placeholder="Price"
                    value={r.price}
                    onChange={(e) => set(i, { price: e.target.value })}
                  />
                </div>
                <div className="col-span-3 text-xs tabular-nums text-muted-foreground">
                  {rr != null ? `${rr.toFixed(2)}R` : "—"}
                </div>
                <div className="col-span-1 flex justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label={`Remove level ${i + 1}`}
                    onClick={() => onChange(rows.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7"
          onClick={() => onChange([...rows, { pct: "", price: "" }])}
        >
          Add level
        </Button>

        {rows.length > 0 && (
          <span
            className={cn(
              "text-xs tabular-nums",
              over ? "text-[var(--loss)]" : "text-muted-foreground",
            )}
          >
            Total: {total}% · Remaining: {MAX_SCALE_OUT_PCT - total}%
          </span>
        )}
      </div>
    </div>
  );
}
