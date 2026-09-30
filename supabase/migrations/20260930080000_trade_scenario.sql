-- Šta bi bilo (faza L, odluke L1–L4, 30.09.2026).
--
-- futures-trading/tools/journal_mae.py upisuje za svaki zatvoren fjučers trejd sa stopom, posle kraja njegovog
-- Topstep dana, iz berzanskih sveća (R2): SL × TP mrežu (SL 0,5–2× stvarnog, TP 1–5R, rezultat u R varijante),
-- pomeranje cene 15 / 30 / 60 min i do kraja dana posle izlaza, da li je posle stopa došao planirani TP i koliki
-- SL bi preživeo do TP-a. Journal to samo čita.
--
-- Scenario važi za tačno te fill-ove i taj zapečaćeni plan: čim se fill-ovi trejda promene (izmena, spajanje,
-- uvoz, undo) ili se plan ponovo zapečati, scenario se briše, a sledeće pokretanje ga računa iz novih podataka.

ALTER TABLE public.tj_positions ADD COLUMN IF NOT EXISTS scenario jsonb;

ALTER TABLE public.tj_positions DROP CONSTRAINT IF EXISTS tj_positions_scenario_object;
ALTER TABLE public.tj_positions ADD CONSTRAINT tj_positions_scenario_object
  CHECK (scenario IS NULL OR jsonb_typeof(scenario) = 'object');

COMMENT ON COLUMN public.tj_positions.scenario IS
  'What-if from exchange candles (futures-trading journal_mae.py, v1): SL x TP grid, price after exit, after stop. Cleared when fills or the sealed plan change.';

CREATE OR REPLACE FUNCTION public.tj_clear_scenario_on_fills()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update public.tj_positions set scenario = null where id = old.position_id and scenario is not null;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    update public.tj_positions set scenario = null where id = new.position_id and scenario is not null;
  end if;
  return null;
end;
$function$;

DROP TRIGGER IF EXISTS tj_executions_clear_scenario ON public.tj_executions;
CREATE TRIGGER tj_executions_clear_scenario
  AFTER INSERT OR UPDATE OR DELETE ON public.tj_executions
  FOR EACH ROW EXECUTE FUNCTION public.tj_clear_scenario_on_fills();

CREATE OR REPLACE FUNCTION public.tj_clear_scenario_on_plan()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.plan_snapshot is distinct from old.plan_snapshot then
    new.scenario := null;
  end if;
  return new;
end;
$function$;

DROP TRIGGER IF EXISTS tj_positions_clear_scenario ON public.tj_positions;
CREATE TRIGGER tj_positions_clear_scenario
  BEFORE UPDATE OF plan_snapshot ON public.tj_positions
  FOR EACH ROW EXECUTE FUNCTION public.tj_clear_scenario_on_plan();

REVOKE ALL ON FUNCTION public.tj_clear_scenario_on_fills() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tj_clear_scenario_on_plan() FROM PUBLIC, anon, authenticated;
