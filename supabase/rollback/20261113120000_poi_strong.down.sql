-- Vraća 20261113120000_poi_strong.sql (faza SP): briše kolonu poi_strong.
ALTER TABLE public.tj_positions DROP COLUMN IF EXISTS poi_strong;
