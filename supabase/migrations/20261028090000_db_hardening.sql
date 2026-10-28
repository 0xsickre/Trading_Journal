-- Generalna provera journala, deo 1 (28.10.2026): nalazi Supabase advisora za bezbednost.
--
-- ZAŠTO. Trejder je tražio proveru celog journala „da bude sigurno da je 100 % ispravan“. Advisor je javio:
--   * `tj_bulk_add_tag` nema zaključan `search_path` (svaka druga funkcija ga ima);
--   * trigger funkcije `tj_link_criterion_always` i `tj_rule_show_when_vs_criterion` (SECURITY DEFINER) mogu da se
--     pozovu preko `/rest/v1/rpc/…` i kao `anon`. Trigger funkcija pozvana direktno ne radi ništa (Postgres je odbija),
--     ali pravo izvršavanja ne treba da postoji. Isto važi za ostale trigger funkcije koje još imaju podrazumevano
--     pravo za PUBLIC (među njima i `tj_daily_report_state_at` iz `20261027140000`).
--
-- ŠTA. Samo prava i podešavanje funkcija; nijedan red podataka se ne menja. Okidači rade i dalje: Postgres pri
-- okidanju ne proverava EXECUTE na trigger funkciji.

ALTER FUNCTION public.tj_bulk_add_tag(uuid[], text, text[]) SET search_path TO '';

DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prorettype = 'pg_catalog.trigger'::regtype
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
  END LOOP;
END;
$$;
