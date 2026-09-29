"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ChartImageInput, ChartThumb } from "@/components/journal/chart-image-input";
import { removeStoredImage } from "@/lib/journal/trade-image-storage";
import {
  TRADE_IMAGE_KINDS,
  TRADE_IMAGE_KIND_HINTS,
  TRADE_IMAGE_KIND_LABELS,
  type TradeImageKind,
  validateTradeImageRef,
} from "@/lib/journal/tradingview-snapshot";

type SlotRow = {
  id: string;
  kind: TradeImageKind;
  image_url: string;
};

type Drafts = Record<TradeImageKind, string>;

const EMPTY_DRAFTS = (): Drafts => ({
  htf_pre: "",
  ltf_pre: "",
  ltf_post: "",
});

export function TradeImages({ positionId }: { positionId: string }) {
  const [slots, setSlots] = useState<Partial<Record<TradeImageKind, SlotRow>>>(
    {},
  );
  const [drafts, setDrafts] = useState<Drafts>(EMPTY_DRAFTS);
  const [loading, setLoading] = useState(true);
  const [savingKind, setSavingKind] = useState<TradeImageKind | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    setLoading(true);
    const { data: rows, error } = await supabase
      .from("tj_trade_images")
      .select("id, kind, image_url")
      .eq("position_id", positionId);
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }
    const next: Partial<Record<TradeImageKind, SlotRow>> = {};
    const nextDrafts = EMPTY_DRAFTS();
    for (const r of rows ?? []) {
      const kind = r.kind as TradeImageKind;
      if (!TRADE_IMAGE_KINDS.includes(kind)) continue;
      next[kind] = {
        id: r.id,
        kind,
        image_url: r.image_url,
      };
      nextDrafts[kind] = r.image_url;
    }
    setSlots(next);
    setDrafts(nextDrafts);
    setLoading(false);
  }, [positionId]);

  // Async data fetch on mount / when the position changes (load() sets loading
  // state internally — a legitimate data-fetching effect).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch
    load();
  }, [load]);

  async function save(kind: TradeImageKind) {
    const validated = validateTradeImageRef(drafts[kind]);
    if (!validated.ok) {
      toast.error(validated.message);
      return;
    }
    const before = slots[kind]?.image_url;
    setSavingKind(kind);
    try {
      const supabase = createClient();
      const { error } = await supabase.from("tj_trade_images").upsert(
        {
          position_id: positionId,
          kind,
          image_url: validated.url,
        },
        { onConflict: "position_id,kind" },
      );
      if (error) throw error;
      // The replaced image's file goes with it; a link has none.
      if (before && before !== validated.url) await removeStoredImage(before);
      toast.success(`${TRADE_IMAGE_KIND_LABELS[kind]} saved`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSavingKind(null);
    }
  }

  async function clear(kind: TradeImageKind) {
    const row = slots[kind];
    if (!row) {
      setDrafts((d) => ({ ...d, [kind]: "" }));
      return;
    }
    setSavingKind(kind);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("tj_trade_images")
        .delete()
        .eq("id", row.id);
      if (error) throw error;
      await removeStoredImage(row.image_url);
      setSlots((prev) => {
        const copy = { ...prev };
        delete copy[kind];
        return copy;
      });
      setDrafts((d) => ({ ...d, [kind]: "" }));
      toast.success("Removed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Remove failed");
    } finally {
      setSavingKind(null);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Chart snapshots</CardTitle>
        <p className="text-sm text-muted-foreground">
          Upload a screenshot, paste one from the clipboard, or paste a TradingView
          &quot;Copy link to chart image&quot; (<code className="text-xs">tradingview.com/x/…</code>).
          An uploaded image is kept in the journal, not on TradingView.
        </p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            {TRADE_IMAGE_KINDS.map((kind) => {
              const saved = slots[kind];
              const busy = savingKind === kind;
              return (
                <div key={kind} className="space-y-2 rounded-md border p-3">
                  <div>
                    <Label htmlFor={`tv-${kind}`}>{TRADE_IMAGE_KIND_LABELS[kind]}</Label>
                    <p className="text-xs text-muted-foreground">{TRADE_IMAGE_KIND_HINTS[kind]}</p>
                  </div>
                  {saved ? <ChartThumb imageRef={saved.image_url} label={TRADE_IMAGE_KIND_LABELS[kind]} /> : null}
                  <ChartImageInput
                    id={`tv-${kind}`}
                    value={drafts[kind]}
                    onChange={(ref) => setDrafts((d) => ({ ...d, [kind]: ref }))}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" disabled={busy} onClick={() => save(kind)}>
                      {busy ? <Loader2 className="size-4 animate-spin" /> : "Save"}
                    </Button>
                    {(saved || drafts[kind]) && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => clear(kind)}
                        aria-label={`Remove ${TRADE_IMAGE_KIND_LABELS[kind]}`}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
