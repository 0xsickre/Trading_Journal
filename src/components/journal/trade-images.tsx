"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ExternalLink, Loader2, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  TRADE_IMAGE_KINDS,
  TRADE_IMAGE_KIND_HINTS,
  TRADE_IMAGE_KIND_LABELS,
  type TradeImageKind,
  tradingViewSnapshotPngUrl,
  validateTradingViewSnapshotUrl,
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

function Carousel({
  title,
  urls,
}: {
  title: string;
  urls: { label: string; pageUrl: string; pngUrl: string }[];
}) {
  if (urls.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {urls.map((item) => (
          <a
            key={item.pageUrl}
            href={item.pageUrl}
            target="_blank"
            rel="noreferrer"
            className="block min-w-[140px] shrink-0 overflow-hidden rounded-md border"
            title={item.label}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.pngUrl}
              alt={item.label}
              className="aspect-video w-full object-cover"
            />
            <span className="block truncate px-2 py-1 text-xs text-muted-foreground">
              {item.label}
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}

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

  useEffect(() => {
    load();
  }, [load]);

  async function save(kind: TradeImageKind) {
    const validated = validateTradingViewSnapshotUrl(drafts[kind]);
    if (!validated.ok) {
      toast.error(validated.message);
      return;
    }
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

  async function paste(kind: TradeImageKind) {
    try {
      const text = await navigator.clipboard.readText();
      setDrafts((d) => ({ ...d, [kind]: text.trim() }));
    } catch {
      toast.error("Clipboard access denied");
    }
  }

  const preCarousel = useMemo(() => {
    return (["htf_pre", "ltf_pre"] as const)
      .map((kind) => {
        const url = slots[kind]?.image_url;
        if (!url) return null;
        const png = tradingViewSnapshotPngUrl(url);
        if (!png) return null;
        return {
          label: TRADE_IMAGE_KIND_LABELS[kind],
          pageUrl: url,
          pngUrl: png,
        };
      })
      .filter(Boolean) as { label: string; pageUrl: string; pngUrl: string }[];
  }, [slots]);

  const postCarousel = useMemo(() => {
    const url = slots.ltf_post?.image_url;
    if (!url) return [];
    const png = tradingViewSnapshotPngUrl(url);
    if (!png) return [];
    return [
      {
        label: TRADE_IMAGE_KIND_LABELS.ltf_post,
        pageUrl: url,
        pngUrl: png,
      },
    ];
  }, [slots]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Chart snapshots</CardTitle>
        <p className="text-sm text-muted-foreground">
          Paste TradingView &quot;Copy link to chart image&quot; (
          <code className="text-xs">tradingview.com/x/…</code>), not the
          interactive chart link.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-3">
              {TRADE_IMAGE_KINDS.map((kind) => {
                const saved = slots[kind];
                const png = saved
                  ? tradingViewSnapshotPngUrl(saved.image_url)
                  : null;
                const busy = savingKind === kind;
                return (
                  <div key={kind} className="space-y-2 rounded-md border p-3">
                    <div>
                      <Label htmlFor={`tv-${kind}`}>
                        {TRADE_IMAGE_KIND_LABELS[kind]}
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        {TRADE_IMAGE_KIND_HINTS[kind]}
                      </p>
                    </div>
                    {png && saved ? (
                      <a
                        href={saved.image_url}
                        target="_blank"
                        rel="noreferrer"
                        className="relative block overflow-hidden rounded-md border"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={png}
                          alt={TRADE_IMAGE_KIND_LABELS[kind]}
                          className="aspect-video w-full object-cover"
                        />
                        <span className="absolute right-1 top-1 rounded bg-background/80 p-1">
                          <ExternalLink className="size-3.5" />
                        </span>
                      </a>
                    ) : null}
                    <Input
                      id={`tv-${kind}`}
                      value={drafts[kind]}
                      onChange={(e) =>
                        setDrafts((d) => ({ ...d, [kind]: e.target.value }))
                      }
                      placeholder="https://www.tradingview.com/x/…"
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => paste(kind)}
                      >
                        Paste
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy}
                        onClick={() => save(kind)}
                      >
                        {busy ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          "Save"
                        )}
                      </Button>
                      {(saved || drafts[kind]) && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => clear(kind)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {(preCarousel.length > 0 || postCarousel.length > 0) && (
              <div className="space-y-4 border-t pt-4">
                <Carousel title="Pre-trade" urls={preCarousel} />
                <Carousel title="Post-trade" urls={postCarousel} />
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
