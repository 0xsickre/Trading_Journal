"use client";

import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChartImageInput } from "@/components/journal/chart-image-input";
import { MAX_TRADE_IMAGES } from "@/lib/journal/tradingview-snapshot";

/**
 * The drafts as a save wants them: the filled ones, trimmed, in order.
 *
 * A separate function rather than an inline filter in the form's submit,
 * because it is the one part of this feature worth asserting directly — an
 * untouched "+" field is not an intent to attach a blank chart.
 */
export function imageDraftsToPayload(drafts: readonly string[]): string[] {
  return drafts.map((d) => d.trim()).filter(Boolean);
}

/**
 * Chart pictures as a list the trader grows with "+" (30.09.2026): each field
 * takes an upload, a paste from the clipboard or a TradingView snapshot link.
 * Holds strings only; whoever renders it decides when they are written.
 */
export function ChartImageListInput({
  value,
  onChange,
  idPrefix,
  addLabel = "Add chart",
}: {
  value: readonly string[];
  onChange: (next: string[]) => void;
  /** Ids for the fields, `${idPrefix}-0`, `-1`…, so a label can point at the first. */
  idPrefix: string;
  addLabel?: string;
}) {
  const set = (i: number, ref: string) => onChange(value.map((v, j) => (j === i ? ref : v)));
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i));
  return (
    <div className="space-y-2">
      {value.map((ref, i) => (
        <div key={i} className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <ChartImageInput id={`${idPrefix}-${i}`} value={ref} onChange={(r) => set(i, r)} />
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-8 shrink-0"
            aria-label={`Remove chart ${i + 1}`}
            onClick={() => remove(i)}
          >
            <X className="size-4" />
          </Button>
        </div>
      ))}
      {value.length < MAX_TRADE_IMAGES && (
        <Button type="button" size="sm" variant="outline" onClick={() => onChange([...value, ""])}>
          <Plus className="size-4" /> {addLabel}
        </Button>
      )}
    </div>
  );
}
