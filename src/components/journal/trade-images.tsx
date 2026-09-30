"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartThumb } from "@/components/journal/chart-image-input";
import { ChartImageListInput, imageDraftsToPayload } from "@/components/journal/trade-image-drafts";
import { removeStoredImage } from "@/lib/journal/trade-image-storage";
import {
  MAX_TRADE_IMAGES,
  TRADE_IMAGE_KIND,
  validateTradeImageList,
} from "@/lib/journal/tradingview-snapshot";

type ImageRow = { id: string; image_url: string; sort_order: number };

/**
 * The charts of a saved trade, as a list (30.09.2026): every picture it has, in
 * the order added, each removable, and "+" for more. A new one goes after the
 * last; removing one takes its uploaded file with it.
 */
export function TradeImages({ positionId }: { positionId: string }) {
  const [rows, setRows] = useState<ImageRow[]>([]);
  const [drafts, setDrafts] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await createClient()
      .from("tj_trade_images")
      .select("id, image_url, sort_order")
      .eq("position_id", positionId)
      .order("sort_order")
      .order("id");
    if (error) toast.error(error.message);
    setRows(data ?? []);
    setLoading(false);
  }, [positionId]);

  // Async data fetch on mount / when the position changes (load() sets loading
  // state internally — a legitimate data-fetching effect).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch
    load();
  }, [load]);

  async function saveDrafts() {
    const list = validateTradeImageList(imageDraftsToPayload(drafts));
    if (!list.ok) {
      toast.error(list.error);
      return;
    }
    if (list.urls.length === 0) return;
    if (rows.length + list.urls.length > MAX_TRADE_IMAGES) {
      toast.error(`At most ${MAX_TRADE_IMAGES} charts on one trade.`);
      return;
    }
    setBusy(true);
    const start = rows.reduce((m, r) => Math.max(m, r.sort_order), -1) + 1;
    const { error } = await createClient()
      .from("tj_trade_images")
      .insert(
        list.urls.map((image_url, i) => ({
          position_id: positionId,
          kind: TRADE_IMAGE_KIND,
          image_url,
          sort_order: start + i,
        })),
      );
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(list.urls.length === 1 ? "Chart saved" : `${list.urls.length} charts saved`);
    setDrafts([]);
    await load();
  }

  async function remove(row: ImageRow) {
    setBusy(true);
    const { error } = await createClient().from("tj_trade_images").delete().eq("id", row.id);
    if (error) {
      setBusy(false);
      toast.error(error.message);
      return;
    }
    // The uploaded file goes with its row; a link has none.
    await removeStoredImage(row.image_url);
    setBusy(false);
    setRows((prev) => prev.filter((r) => r.id !== row.id));
    toast.success("Removed");
  }

  const pending = imageDraftsToPayload(drafts).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Charts</CardTitle>
        <p className="text-sm text-muted-foreground">
          As many as you like: upload a screenshot, paste one from the clipboard, or paste a
          TradingView &quot;Copy link to chart image&quot; (<code className="text-xs">tradingview.com/x/…</code>).
          An uploaded image is kept in the journal, not on TradingView.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          rows.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {rows.map((row, i) => (
                <div key={row.id} className="space-y-2 rounded-md border p-2">
                  <ChartThumb imageRef={row.image_url} label={`Chart ${i + 1}`} />
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Chart {i + 1}</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => remove(row)}
                      aria-label={`Remove chart ${i + 1}`}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
        <ChartImageListInput value={drafts} onChange={setDrafts} idPrefix={`chart-${positionId}`} />
        {pending > 0 && (
          <Button type="button" size="sm" disabled={busy} onClick={saveDrafts}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : pending === 1 ? "Save chart" : `Save ${pending} charts`}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
