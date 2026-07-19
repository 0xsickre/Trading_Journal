-- TradingView snapshot gallery: store /x/ URLs in tj_trade_images (no Supabase Storage).
-- Legacy storage uploads are dropped (TV-only). chart_url on tj_positions migrates to ltf_pre.

-- 1) Remove legacy storage-only rows (bucket files become orphaned — delete bucket manually if needed)
DELETE FROM public.tj_trade_images;

-- 2) Drop old kind constraint and storage_path
ALTER TABLE public.tj_trade_images
  DROP CONSTRAINT IF EXISTS tj_trade_images_kind_check;

ALTER TABLE public.tj_trade_images
  DROP COLUMN storage_path;

-- 3) Add image_url (nullable during backfill)
ALTER TABLE public.tj_trade_images
  ADD COLUMN IF NOT EXISTS image_url text;

-- 4) Migrate chart_url -> ltf_pre snapshot rows
INSERT INTO public.tj_trade_images (user_id, position_id, kind, image_url, caption)
SELECT
  p.user_id,
  p.id,
  'ltf_pre',
  'https://www.tradingview.com/x/'
    || (regexp_match(btrim(p.chart_url), 'tradingview\.com/x/([A-Za-z0-9]+)', 'i'))[1]
    || '/',
  NULL
FROM public.tj_positions p
WHERE p.chart_url IS NOT NULL
  AND btrim(p.chart_url) <> ''
  AND p.chart_url ~* 'tradingview\.com/x/[A-Za-z0-9]+';

-- 5) Enforce NOT NULL image_url (table should only hold TV URLs going forward)
ALTER TABLE public.tj_trade_images
  ALTER COLUMN image_url SET NOT NULL;

ALTER TABLE public.tj_trade_images
  ALTER COLUMN kind SET DEFAULT 'ltf_pre';

ALTER TABLE public.tj_trade_images
  ADD CONSTRAINT tj_trade_images_kind_check
  CHECK (kind = ANY (ARRAY['htf_pre'::text, 'ltf_pre'::text, 'ltf_post'::text]));

CREATE UNIQUE INDEX IF NOT EXISTS tj_trade_images_position_kind_uidx
  ON public.tj_trade_images (position_id, kind);

-- 6) Drop redundant chart_url on positions (gallery is single source of truth)
ALTER TABLE public.tj_positions
  DROP COLUMN IF EXISTS chart_url;
