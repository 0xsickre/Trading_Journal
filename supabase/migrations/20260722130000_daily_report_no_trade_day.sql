-- No-trade day flag on daily reports

ALTER TABLE public.tj_daily_reports
  ADD COLUMN IF NOT EXISTS no_trade_day boolean NOT NULL DEFAULT false;
