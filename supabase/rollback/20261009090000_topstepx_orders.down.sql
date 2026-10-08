-- Povratak za migrations/20261009090000_topstepx_orders.sql
--
-- ŠTA BRIŠE: kolone tj_positions.final_stop_price i entry_order_type, sa
-- vrednostima koje je upisao uvoz naloga. stop_price koji je uvoz upisao OSTAJE
-- (to je obična kolona trejda). tj_undo_import_batch se vraća na verziju iz
-- 20260930040000 (bez clear_stop / clear_orders).
--
-- KADA GA NE POKRETATI: dok kod u journal-u upisuje ove kolone (faza O) — uvoz bi
-- pao na nepostojećoj koloni. Prvo vrati kod.

ALTER TABLE public.tj_positions DROP CONSTRAINT IF EXISTS tj_positions_final_stop_price_positive;
ALTER TABLE public.tj_positions DROP CONSTRAINT IF EXISTS tj_positions_entry_order_type_check;
ALTER TABLE public.tj_positions DROP COLUMN IF EXISTS final_stop_price;
ALTER TABLE public.tj_positions DROP COLUMN IF EXISTS entry_order_type;

-- Zatim ponovo pokreni definiciju tj_undo_import_batch iz
-- migrations/20260930040000_undo_clears_exit_reason.sql.
