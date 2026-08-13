import "server-only";
import { createClient } from "@/lib/supabase/server";
import { selectAllPages } from "@/lib/supabase/paginate";
import type {
  PositionCheckin,
  ThesisState,
  TouchedState,
} from "./position-checkin";

type CheckinRow = {
  id: string;
  position_id: string;
  report_date: string;
  thesis_state: string | null;
  touched: string | null;
  note: string | null;
};

/**
 * Casts rather than validates, in step with `tracker/queries.ts`.
 *
 * The DB CHECK constraint is the guard, and it refuses any value outside the two
 * closed sets — so a row that reached this function already passed the same test
 * a runtime check here would apply.
 */
function toCheckin(r: CheckinRow): PositionCheckin {
  return {
    id: r.id,
    position_id: r.position_id,
    report_date: r.report_date,
    thesis_state: (r.thesis_state as ThesisState | null) ?? null,
    touched: (r.touched as TouchedState | null) ?? null,
    note: r.note,
  };
}

const COLUMNS = "id, position_id, report_date, thesis_state, touched, note";

/**
 * Every check-in, flat.
 *
 * Paged for the same reason `getCheckins` is: this is one row per open position
 * per day, so a book with a few concurrent positions outgrows a single PostgREST
 * page within a year — and a short page here would not error, it would quietly
 * report positions as never checked.
 */
export async function getPositionCheckins(): Promise<PositionCheckin[]> {
  const supabase = await createClient();
  const rows = await selectAllPages<CheckinRow>((lo, hi) =>
    supabase
      .from("tj_position_checkins")
      .select(COLUMNS)
      .order("report_date")
      .order("id")
      .range(lo, hi),
  );
  return rows.map(toCheckin);
}

/** One day's check-ins, indexed by position id — what `/daily` renders from. */
export async function getPositionCheckinsForDay(
  date: string,
): Promise<Map<string, PositionCheckin>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tj_position_checkins")
    .select(COLUMNS)
    .eq("report_date", date);

  const out = new Map<string, PositionCheckin>();
  for (const r of (data ?? []) as CheckinRow[]) {
    out.set(r.position_id, toCheckin(r));
  }
  return out;
}
