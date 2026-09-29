/**
 * Chart images kept in the journal's own storage (K6).
 *
 * The private `trade-images` bucket, one folder per user — storage RLS lets a
 * signed-in user write, read and delete only under their own id, and the
 * `tj_trade_images` CHECK holds a stored reference to the row's own user. A
 * file is shown through a signed URL that lives an hour, never a public link.
 */

import { createClient } from "@/lib/supabase/client";
import { STORED_IMAGE_PREFIX, storedImagePath, tradingViewSnapshotPngUrl } from "./tradingview-snapshot";

export const TRADE_IMAGE_BUCKET = "trade-images";

/** The bucket's own limit, said before the upload rather than after it fails. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const EXTENSION: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export type UploadResult = { ok: true; ref: string } | { ok: false; error: string };

/** Why a file cannot be stored, or null when it can — checked before any network call. */
export function imageFileProblem(file: { type: string; size: number }): string | null {
  if (!EXTENSION[file.type]) return "Only PNG, JPEG or WebP images can be stored.";
  if (file.size > MAX_IMAGE_BYTES) return "The image is larger than 10 MB.";
  return null;
}

/** Upload one image under the signed-in user's folder; the reference the row stores comes back. */
export async function uploadTradeImage(file: File): Promise<UploadResult> {
  const problem = imageFileProblem(file);
  if (problem) return { ok: false, error: problem };
  const supabase = createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: "Not signed in." };
  const path = `${auth.user.id}/${crypto.randomUUID()}.${EXTENSION[file.type]}`;
  const { error } = await supabase.storage
    .from(TRADE_IMAGE_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, ref: `${STORED_IMAGE_PREFIX}${path}` };
}

/** Remove a stored image's file. A TradingView link has no file, so it is a no-op. */
export async function removeStoredImage(ref: string): Promise<void> {
  const path = storedImagePath(ref);
  if (!path) return;
  await createClient().storage.from(TRADE_IMAGE_BUCKET).remove([path]);
}

/**
 * What to show and where to open it: the snapshot PNG and its TradingView page
 * for a link, a signed URL for both on a stored image. Null when neither works.
 */
export async function resolveTradeImage(ref: string): Promise<{ src: string; href: string } | null> {
  const path = storedImagePath(ref);
  if (path) {
    const { data } = await createClient().storage.from(TRADE_IMAGE_BUCKET).createSignedUrl(path, 3600);
    return data?.signedUrl ? { src: data.signedUrl, href: data.signedUrl } : null;
  }
  const png = tradingViewSnapshotPngUrl(ref);
  return png ? { src: png, href: ref } : null;
}
