"use client";

import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartImageInput } from "@/components/journal/chart-image-input";
import { MAX_TRADE_IMAGES } from "@/lib/journal/tradingview-snapshot";

/**
 * The drafts as `createTrade` wants them: the filled ones, trimmed, in order.
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

/**
 * Charts on a trade that does not exist yet.
 *
 * A separate component from `TradeImages` rather than a mode flag on it, and
 * the split is by JOB, not by convenience. `TradeImages` owns rows: it reads
 * them, inserts them, deletes them, and every one of those needs a position id
 * to key on. This one owns strings in form state and writes nothing —
 * `createTrade` persists them, in order, once the position has an id.
 *
 * It exists because the screenshot is taken at PLANNING time: the chart that
 * made you want the trade is the most useful artifact of the plan.
 */
export function TradeImageDrafts({
  drafts,
  onChange,
}: {
  drafts: readonly string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Charts</CardTitle>
        <p className="text-sm text-muted-foreground">
          As many as you like: upload a screenshot, paste one from the clipboard, or paste a
          TradingView snapshot link (camera → <i>Copy link to chart image</i>). Saved with the trade.
        </p>
      </CardHeader>
      <CardContent>
        {/* No preview here on purpose: a thumbnail would need the link to be
            valid, and the honest moment to reject a bad link is the save, where
            the server validates it with the same function. */}
        <ChartImageListInput value={drafts} onChange={onChange} idPrefix="new-chart" />
      </CardContent>
    </Card>
  );
}
