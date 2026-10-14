import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { selectAllByIds, selectAllPages } from "@/lib/supabase/paginate";
import { narrowPositionStat } from "./types";
import { scenarioTrade, type ScenarioTrade } from "./scenario";
import type { PositionStat, TradeRow } from "./types";

export type { TradeRow } from "./types";

/** Position joined with its derived stats — the row shape for the journal grid. */
export type TradeWithStats = TradeRow;

type RawPosition = Record<string, unknown> & {
  id: string;
  account_id: string | null;
  trade_no: number | null;
};

async function readTradesWithStats(
  accountId?: string | null,
): Promise<TradeWithStats[]> {
  const supabase = await createClient();

  // Every figure on the dashboard is derived from this set, so it must be the
  // WHOLE set: an unbounded select silently stops at PostgREST's row cap.
  // `id` breaks ties so paging cannot repeat or skip a row when two positions
  // share a created_at.
  const positions = await selectAllPages<RawPosition>((from, to) => {
    let q = supabase
      .from("tj_positions")
      .select("*")
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, to);
    if (accountId) q = q.eq("account_id", accountId);
    return q;
  });

  const positionIds = positions.map((p) => p.id);

  const [statRows, images, playbooks] = await Promise.all([
    selectAllByIds(positionIds, (chunk, from, to) =>
      supabase
        .from("tj_position_stats")
        .select("*")
        .in("position_id", chunk)
        .order("position_id")
        .range(from, to),
    ),
    selectAllByIds(positionIds, (chunk, from, to) =>
      supabase
        .from("tj_trade_images")
        .select("position_id, image_url, sort_order, id")
        .in("position_id", chunk)
        .order("position_id")
        .order("sort_order")
        .order("id")
        .range(from, to),
    ),
    // When each playbook was written (phase Y): the tracker fails a trade whose
    // playbook came after its entry, and the mentor pack says so. A handful of
    // rows per user, so one read.
    supabase.from("tj_playbooks").select("id, created_at"),
  ]);
  if (playbooks.error) throw new Error(playbooks.error.message);
  const playbookCreatedAt = new Map((playbooks.data ?? []).map((p) => [p.id, p.created_at]));

  // Already in order: by position, then as the trader added them.
  const imagesByPosition = new Map<string, string[]>();
  for (const img of images) {
    const list = imagesByPosition.get(img.position_id) ?? [];
    list.push(img.image_url);
    imagesByPosition.set(img.position_id, list);
  }

  // `narrowPositionStat` instead of `statRows as PositionStat[]`. The cast
  // asserted three fields to be non-null and two of them to be closed unions,
  // and nothing anywhere checked it. The function checks, and an unrecognised
  // source falls to `missing` — the label that reads as "unpriced" rather than
  // as "verified".
  const statById = new Map<string, PositionStat>();
  for (const row of statRows) {
    const s = narrowPositionStat(row);
    if (s) statById.set(s.position_id, s);
  }

  return positions.map(
    (p) =>
      ({
        ...p,
        stats: statById.get(p.id) ?? null,
        chart_images: imagesByPosition.get(p.id) ?? [],
        playbook_created_at:
          typeof p.playbook_id === "string" ? (playbookCreatedAt.get(p.playbook_id) ?? null) : null,
      }) as TradeRow,
  );
}

// Memoized per request (React `cache`), like `getCurrentUser` and `getFieldDefs`: a page
// and the helpers it calls ask for this more than once in one render, and each ask
// was its own round trip to the database.
export const getTradesWithStats = cache(readTradesWithStats);

/**
 * One trade's what-if (phase L) with the cost figures its grid is netted by —
 * null until futures-trading has measured it.
 */
export async function getTradeScenario(id: string): Promise<ScenarioTrade | null> {
  const supabase = await createClient();
  const [{ data: pos }, { data: stats }] = await Promise.all([
    supabase.from("tj_positions").select("id, scenario").eq("id", id).maybeSingle(),
    supabase
      .from("tj_position_stats")
      .select("entry_qty, total_fees, point_value, fx_rate, realized_r, realized_r_net")
      .eq("position_id", id)
      .maybeSingle(),
  ]);
  if (!pos?.scenario) return null;
  return scenarioTrade({ ...pos, stats } as unknown as TradeRow);
}

/**
 * Number of entry and exit fills per position.
 *
 * `entry_qty` in the stats view is a quantity, not a count — a single 3-lot
 * fill and three 1-lot fills look identical there. Scale-in / scale-out
 * detection needs the row count, so it is fetched separately.
 */
async function readFillCounts(): Promise<
  Map<string, { entries: number; exits: number }>
> {
  const supabase = await createClient();

  // A silently short page here would under-count fills and make scale-in /
  // scale-out detection quietly wrong — see the note in supabase/paginate.ts.
  const rows = await selectAllPages<{ position_id: string; side: string }>(
    (from, to) =>
      supabase
        .from("tj_executions")
        .select("position_id, side")
        .order("position_id")
        .order("id")
        .range(from, to),
  );

  const map = new Map<string, { entries: number; exits: number }>();
  for (const row of rows) {
    const bucket = map.get(row.position_id) ?? { entries: 0, exits: 0 };
    if (row.side === "entry") bucket.entries++;
    else bucket.exits++;
    map.set(row.position_id, bucket);
  }

  return map;
}

// Memoized per request (React `cache`), like `getCurrentUser` and `getFieldDefs`: a page
// and the helpers it calls ask for this more than once in one render, and each ask
// was its own round trip to the database.
export const getFillCounts = cache(readFillCounts);
