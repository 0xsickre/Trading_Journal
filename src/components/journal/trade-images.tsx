"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ImagePlus, Trash2, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Img = { id: string; storage_path: string; url: string; caption: string | null };

const BUCKET = "trade-images";

export function TradeImages({ positionId }: { positionId: string }) {
  const supabase = createClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState<Img[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  async function load() {
    setLoading(true);
    const { data: rows } = await supabase
      .from("tj_trade_images")
      .select("id,storage_path,caption")
      .eq("position_id", positionId)
      .order("created_at");
    const withUrls: Img[] = [];
    for (const r of rows ?? []) {
      const { data: signed } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(r.storage_path, 3600);
      withUrls.push({
        id: r.id,
        storage_path: r.storage_path,
        caption: r.caption,
        url: signed?.signedUrl ?? "",
      });
    }
    setImages(withUrls);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positionId]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const ext = file.name.split(".").pop() || "png";
      const path = `${user.id}/${positionId}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { upsert: false });
      if (upErr) throw upErr;
      const { error: dbErr } = await supabase
        .from("tj_trade_images")
        .insert({ position_id: positionId, storage_path: path, kind: "other" });
      if (dbErr) throw dbErr;
      toast.success("Screenshot added");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function remove(img: Img) {
    await supabase.storage.from(BUCKET).remove([img.storage_path]);
    await supabase.from("tj_trade_images").delete().eq("id", img.id);
    setImages((prev) => prev.filter((i) => i.id !== img.id));
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base">Screenshots</CardTitle>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onFile}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <ImagePlus className="size-4" />
          )}
          Add image
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : images.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No screenshots yet — add your TradingView before/after charts.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {images.map((img) => (
              <div key={img.id} className="group relative overflow-hidden rounded-md border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <a href={img.url} target="_blank" rel="noreferrer">
                  <img
                    src={img.url}
                    alt={img.caption ?? "Trade screenshot"}
                    className="aspect-video w-full object-cover"
                  />
                </a>
                <Button
                  type="button"
                  variant="destructive"
                  size="icon"
                  className="absolute right-1 top-1 size-7 opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={() => remove(img)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
