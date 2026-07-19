-- Drop Market Analysis module (tables, option lists, seed helpers).
-- Journal-only: trade positions, import, dashboard stats.

-- 1) Drop analysis tables (CASCADE policies/indexes)
DROP TABLE IF EXISTS public.tj_pair_cot CASCADE;
DROP TABLE IF EXISTS public.tj_bias_analyses CASCADE;
DROP TABLE IF EXISTS public.tj_cot_legs CASCADE;
DROP TABLE IF EXISTS public.tj_market_context CASCADE;

-- 2) Remove Analysis option lists (items first)
DELETE FROM public.tj_option_items
WHERE list_id IN (
  SELECT id FROM public.tj_option_lists WHERE category = 'Analysis'
);

DELETE FROM public.tj_option_lists WHERE category = 'Analysis';

-- 3) Drop analysis-only seed function
DROP FUNCTION IF EXISTS public.tj_seed_analysis_defaults(uuid);

-- 4) Patch tj_seed_my_defaults: remove call to tj_seed_analysis_defaults
--    (tj_seed_defaults already seeds account + trade lists + instruments only)
CREATE OR REPLACE FUNCTION public.tj_seed_my_defaults()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
 begin
   if auth.uid() is null then
     raise exception 'not authenticated';
   end if;
   perform public.tj_seed_defaults(auth.uid());
   perform public.tj_seed_instruments_defaults(auth.uid());
 end;
 $function$;
