"use client";

import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  TRADE_IMAGE_KIND_HINTS,
  TRADE_IMAGE_KIND_LABELS,
} from "@/lib/journal/tradingview-snapshot";

/** The two slots that describe the setup BEFORE it is taken. */
export const PRE_IMAGE_KINDS = ["htf_pre", "ltf_pre"] as const;
export type PreImageKind = (typeof PRE_IMAGE_KINDS)[number];
export type ImageDrafts = Partial<Record<PreImageKind, string>>;

/**
 * The drafts as `createTrade` wants them: only the slots actually filled.
 *
 * A separate function rather than an inline `Object.entries` in the form's
 * submit, because it is the one part of this feature worth asserting directly.
 * Driving it through the UI would mean opening a Radix Select in jsdom to
 * satisfy the instrument check — a test that fails on the widget rather than on
 * the behaviour.
 *
 * Iterates `PRE_IMAGE_KINDS` instead of the object's own keys, so the payload
 * order is the display order and a stray key on the drafts object cannot reach
 * the server.
 */
export function imageDraftsToPayload(
  drafts: ImageDrafts,
): { kind: PreImageKind; image_url: string }[] {
  return PRE_IMAGE_KINDS.flatMap((kind) => {
    const url = (drafts[kind] ?? "").trim();
    return url ? [{ kind, image_url: url }] : [];
  });
}

/**
 * Chart links on a trade that does not exist yet.
 *
 * A separate component from `TradeImages` rather than a mode flag on it, and
 * the split is by JOB, not by convenience. `TradeImages` owns rows: it reads
 * them, upserts them, deletes them, and every one of those needs a position id
 * to key on. This one owns two strings in form state and writes nothing —
 * `createTrade` persists them once the position has an id.
 *
 * It exists because the screenshot is taken at PLANNING time. The chart that
 * made you want the trade is the single most useful artifact of the plan, and
 * until now it could only be attached after saving — by which point the reader
 * has moved on and the annotated chart is a tab you already closed.
 *
 * Only the two `_pre` slots. `ltf_post` is a picture of an exit that has not
 * happened; offering it here would be asking for a screenshot of the future.
 */
export function TradeImageDrafts({
  drafts,
  onChange,
}: {
  drafts: ImageDrafts;
  onChange: (kind: PreImageKind, url: string) => void;
}) {
  async function paste(kind: PreImageKind) {
    try {
      const text = await navigator.clipboard.readText();
      onChange(kind, text.trim());
    } catch {
      toast.error("Clipboard access denied");
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Chart</CardTitle>
        <p className="text-sm text-muted-foreground">
          Paste TradingView snapshot links (camera → <i>Copy link to chart
          image</i>). Saved with the trade.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {PRE_IMAGE_KINDS.map((kind) => (
          <div key={kind} className="space-y-1.5">
            <Label className="text-xs">
              {TRADE_IMAGE_KIND_LABELS[kind]}
              <span className="ml-2 font-normal text-muted-foreground">
                {TRADE_IMAGE_KIND_HINTS[kind]}
              </span>
            </Label>
            <div className="flex gap-2">
              <Input
                value={drafts[kind] ?? ""}
                onChange={(e) => onChange(kind, e.target.value)}
                placeholder="https://www.tradingview.com/x/…"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => paste(kind)}
              >
                Paste
              </Button>
            </div>
          </div>
        ))}
        {/* No preview here on purpose: a thumbnail would need the link to be
            valid, and the honest moment to reject a bad link is the save, where
            the server validates it with the same function. A preview that
            silently stays blank teaches nothing. */}
      </CardContent>
    </Card>
  );
}
