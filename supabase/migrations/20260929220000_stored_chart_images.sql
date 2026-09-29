-- K6: a chart can be an image kept in the journal, not only a TradingView link (the trader,
-- 29.09.2026: "treba ubaciti da se mogu čuvati slike za chartove a ne linkovi").
--
-- WHY. `tj_trade_images.image_url` held a TradingView snapshot link and its CHECK allowed nothing
-- else, so a screenshot from anywhere else — the platform, a snipping tool — could not be kept, and
-- a TradingView link is a picture on someone else's server. The private `trade-images` bucket
-- existed with no policy, so nobody could write to it.
--
-- HOW IT IS STORED. The same column, one of two shapes: the TradingView link as before, or
-- `storage:<user id>/<file>` — an object in the private bucket, in the folder of the row's own
-- user. One column rather than two keeps every reader (the grid, the review page, the mentor
-- export) on one field; the prefix tells them apart, and the CHECK below ties the folder to the
-- row's `user_id`, so a row cannot point at another user's file. A file is shown through a signed
-- URL (an hour), never a public one.
--
-- STORAGE. RLS on `storage.objects` for this bucket only: a signed-in user reads, writes and
-- deletes under their own folder (`<auth.uid()>/…`) and nowhere else. The bucket takes PNG, JPEG
-- and WebP up to 10 MB — the same limit the app states before it uploads.

ALTER TABLE public.tj_trade_images DROP CONSTRAINT IF EXISTS tj_trade_images_url_check;

ALTER TABLE public.tj_trade_images
  ADD CONSTRAINT tj_trade_images_url_check CHECK (
    image_url ~* '^https://www\.tradingview\.com/x/[a-z0-9]+/?$'
    OR (
      image_url ~ '^storage:[0-9a-f-]{36}/[A-Za-z0-9._-]+$'
      AND split_part(substr(image_url, 9), '/', 1) = user_id::text
    )
  );

UPDATE storage.buckets
   SET public = false,
       file_size_limit = 10485760,
       allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp']
 WHERE id = 'trade-images';

DROP POLICY IF EXISTS tj_trade_images_read_own ON storage.objects;
CREATE POLICY tj_trade_images_read_own ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'trade-images' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

DROP POLICY IF EXISTS tj_trade_images_insert_own ON storage.objects;
CREATE POLICY tj_trade_images_insert_own ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'trade-images' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

DROP POLICY IF EXISTS tj_trade_images_delete_own ON storage.objects;
CREATE POLICY tj_trade_images_delete_own ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'trade-images' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);
