-- Faza Y: kad je upisana kapija pre sesije (trejder, 14.10.2026, odluka Y-2 = A).
--
-- ZAŠTO. Mentalna ocena na /daily je kapija PRE sesije, a journal ne zna kad je upisana: red dana ima
-- samo `created_at` (red može nastati i kroz „Danas ne trgujem“) i `updated_at` (menja ga i
-- zaključavanje). 13.10.2026 ocena je upisana 14.10. u 11:15, a 07.10. u 19:09 posle ulaza u 16:20
-- po Beogradu (mentor, Z-032). Bez vremena upisa paket je čita kao da je postojala pre prvog ulaza.
--
-- ŠTA. `mental_temp_at` = trenutak kad je ocena poslednji put postavljena ili promenjena; NULL kad
-- ocene nema. Piše ga samo okidač (vrednost iz klijenta se ignoriše), pa ne može da se podmetne.
-- /daily i mentor paket je porede sa prvim ulazom dana (Y-3 = A: samo oznaka, tracker se ne menja).
--
-- STARI REDOVI. Dobijaju `created_at` (najbolje što baza zna; za 13.10. je tačno). Zaključani dani se
-- ne menjaju sadržinski (Y-4 = A), ali kolona mora da se popuni, pa se za tu jednu naredbu gase
-- čuvar zaključavanja i `updated_at` okidač, da `updated_at` ostane kakav je bio.

ALTER TABLE public.tj_daily_reports
  ADD COLUMN IF NOT EXISTS mental_temp_at timestamptz;

COMMENT ON COLUMN public.tj_daily_reports.mental_temp_at IS
  'Kad je mentalna ocena (kapija pre sesije) postavljena ili promenjena; piše okidač, faza Y. NULL = nema ocene. Stari redovi: created_at.';

ALTER TABLE public.tj_daily_reports DISABLE TRIGGER tj_daily_reports_lock_guard;
ALTER TABLE public.tj_daily_reports DISABLE TRIGGER tj_daily_reports_updated_at;
UPDATE public.tj_daily_reports
   SET mental_temp_at = created_at
 WHERE mental_temp IS NOT NULL AND mental_temp_at IS NULL;
ALTER TABLE public.tj_daily_reports ENABLE TRIGGER tj_daily_reports_updated_at;
ALTER TABLE public.tj_daily_reports ENABLE TRIGGER tj_daily_reports_lock_guard;

CREATE OR REPLACE FUNCTION public.tj_daily_report_mental_temp_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.mental_temp IS DISTINCT FROM OLD.mental_temp THEN
    NEW.mental_temp_at := CASE WHEN NEW.mental_temp IS NULL THEN NULL ELSE now() END;
  ELSE
    NEW.mental_temp_at := OLD.mental_temp_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tj_daily_reports_mental_temp_at ON public.tj_daily_reports;
CREATE TRIGGER tj_daily_reports_mental_temp_at
  BEFORE INSERT OR UPDATE ON public.tj_daily_reports
  FOR EACH ROW EXECUTE FUNCTION public.tj_daily_report_mental_temp_at();
