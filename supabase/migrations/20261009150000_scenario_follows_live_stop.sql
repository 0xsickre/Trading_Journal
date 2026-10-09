-- "Šta bi bilo" follows the stop the trade is actually read with (09.10.2026, review).
--
-- WHY. `tj_positions.scenario` is computed once by futures-trading
-- (`journal_mae.py`) from the stop read SEALED-FIRST, LIVE-SECOND
-- (`zapecaceno`, the same rule as `tj_sealed_num`), and was cleared only when
-- `plan_snapshot` changed. Since phase O every trade comes in through the import
-- with an empty seal (`{}`), so its stop is the LIVE column: the import writes the
-- orders file's last stop, and "Dopuna iz snimka" later writes the original. That
-- second write changed nothing the trigger watched, so the scenario stayed
-- computed on the last stop — a moved stop's grid, measured against the wrong R.
--
-- Now the scenario is also cleared when the live entry, stop or target changes;
-- the next journal_mae run recomputes it. On a trade whose seal holds the stop, a
-- live edit clears it too and the recomputation gives the same numbers — a wasted
-- run, never a wrong one.

CREATE OR REPLACE FUNCTION public.tj_clear_scenario_on_plan()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.plan_snapshot is distinct from old.plan_snapshot
     or new.stop_price is distinct from old.stop_price
     or new.target_price is distinct from old.target_price
     or new.entry_price is distinct from old.entry_price then
    new.scenario := null;
  end if;
  return new;
end;
$function$;

DROP TRIGGER IF EXISTS tj_positions_clear_scenario ON public.tj_positions;
CREATE TRIGGER tj_positions_clear_scenario
  BEFORE UPDATE OF plan_snapshot, stop_price, target_price, entry_price ON public.tj_positions
  FOR EACH ROW EXECUTE FUNCTION public.tj_clear_scenario_on_plan();

REVOKE ALL ON FUNCTION public.tj_clear_scenario_on_plan() FROM PUBLIC, anon, authenticated;
