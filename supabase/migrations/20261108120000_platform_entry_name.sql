-- Faza TR (08.11.2026): veza trejda u journalu sa ulazom iz Trejd panela u NinjaTrader-u.
--
-- ZAŠTO. Trejder (playbook v2): kontekst ulaza (plan, kapije, Pregled, Order flow, Limiter) Trejd panel sam upisuje u
-- `TrejdPanel\log\ulazi_GGGG-MM.csv` pod imenom naloga ulaza („RP Ulaz <id>“); trejd u journal stiže preko
-- NinjaTrader sinhronizacije (faza I3). Analiza ih spaja po tom imenu, a ulaz mimo Trejda se samo označava
-- („van Trejda“), ne blokira se.
--
-- ŠTA (samo dodaje, ništa ne briše).
--   * `tj_positions.platform_entry_name` — ime naloga ulaza u NinjaTrader-u (`Orders.Name`); piše ga ruta
--     `/api/import/ninjatrader` jednom, samo dok je prazno. NULL = ručni / CSV trejd ili sinhronizovan pre faze TR.

ALTER TABLE public.tj_positions ADD COLUMN IF NOT EXISTS platform_entry_name text;
COMMENT ON COLUMN public.tj_positions.platform_entry_name IS
  'The entry order''s name in NinjaTrader, written by the sync (phase TR): "RP Ulaz <id>" = opened through the Trejd panel, joined to its entry log by that id; any other name = opened outside it; NULL = not from the sync.';
