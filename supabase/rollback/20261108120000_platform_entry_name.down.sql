-- Vraća 20261108120000_platform_entry_name.sql (faza TR): briše kolonu sa imenom naloga ulaza.
ALTER TABLE public.tj_positions DROP COLUMN IF EXISTS platform_entry_name;
