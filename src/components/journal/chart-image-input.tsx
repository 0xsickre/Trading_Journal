"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ExternalLink, ImageIcon, Loader2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isStoredImage } from "@/lib/journal/tradingview-snapshot";
import { resolveTradeImage, uploadTradeImage } from "@/lib/journal/trade-image-storage";

/**
 * One chart slot's value: an uploaded image, or a TradingView snapshot link (K6).
 *
 * Three ways in, because a screenshot is taken three ways: **Upload** a file,
 * **Paste** — an image straight from the clipboard (a screenshot tool, TradingView's
 * "Copy chart image") or a link — and Ctrl+V into the box, which does the same.
 * A stored image shows as a small chip rather than its `storage:` reference.
 */
export function ChartImageInput({
  id,
  value,
  onChange,
  placeholder = "https://www.tradingview.com/x/…",
}: {
  id?: string;
  value: string;
  onChange: (ref: string) => void;
  placeholder?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function store(file: File) {
    setBusy(true);
    const res = await uploadTradeImage(file);
    setBusy(false);
    if (!res.ok) toast.error(res.error);
    else onChange(res.ref);
  }

  async function pasteFromClipboard() {
    try {
      // An image first: a screenshot on the clipboard is the common case.
      if (navigator.clipboard.read) {
        for (const item of await navigator.clipboard.read()) {
          const type = item.types.find((t) => t.startsWith("image/"));
          if (type) {
            const blob = await item.getType(type);
            await store(new File([blob], "chart", { type }));
            return;
          }
        }
      }
      onChange((await navigator.clipboard.readText()).trim());
    } catch {
      toast.error("Clipboard access denied");
    }
  }

  function onPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const file = Array.from(e.clipboardData.files).find((f) => f.type.startsWith("image/"));
    if (!file) return;
    e.preventDefault();
    void store(file);
  }

  const stored = isStoredImage(value);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {stored ? (
        <span className="inline-flex h-9 flex-1 items-center gap-1.5 rounded-md border px-2 text-sm">
          <ImageIcon className="size-4 text-muted-foreground" />
          Image saved
          <button
            type="button"
            className="ml-auto text-muted-foreground hover:text-foreground"
            aria-label="Remove image"
            onClick={() => onChange("")}
          >
            <X className="size-4" />
          </button>
        </span>
      ) : (
        <Input
          id={id}
          className="min-w-0 flex-1"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onPaste={onPaste}
          placeholder={placeholder}
        />
      )}
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={pasteFromClipboard}>
        Paste
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
        aria-label="Upload image"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void store(file);
        }}
      />
    </div>
  );
}

/** A chart's thumbnail — the snapshot PNG, or a signed URL for a stored image. */
export function ChartThumb({ imageRef, label }: { imageRef: string; label: string }) {
  const [shown, setShown] = useState<{ ref: string; src: string; href: string } | null>(null);
  useEffect(() => {
    let live = true;
    void resolveTradeImage(imageRef).then((r) => {
      if (live && r) setShown({ ref: imageRef, ...r });
    });
    return () => {
      live = false;
    };
  }, [imageRef]);
  if (!shown || shown.ref !== imageRef) return null;
  return (
    <a
      href={shown.href}
      target="_blank"
      rel="noreferrer"
      className="relative block overflow-hidden rounded-md border"
      title={label}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={shown.src} alt={label} className="aspect-video w-full object-cover" />
      <span className="absolute right-1 top-1 rounded bg-background/80 p-1">
        <ExternalLink className="size-3.5" />
      </span>
    </a>
  );
}

/** Open a chart in a new tab — a stored image needs its signed URL first. */
export async function openTradeImage(ref: string): Promise<void> {
  const r = await resolveTradeImage(ref);
  if (r) window.open(r.href, "_blank", "noopener,noreferrer");
  else toast.error("The image could not be opened.");
}
