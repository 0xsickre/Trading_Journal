import "server-only";
import { createClient } from "@/lib/supabase/server";
import { selectAllByIds, selectAllPages } from "@/lib/supabase/paginate";
import { CUSTOM_FIELD_COLUMN, flattenCustom } from "./field-values";
import type { TradeFormInitial } from "@/components/journal/trade-form";
import type { TradeImageKind } from "./tradingview-snapshot";
import type { PositionStat, TradeRow, TradeTvImages } from "./types";

export type { PositionStat, TradeRow } from "./types";

/** Position joined with its derived stats — the row shape for the journal grid. */
export type TradeWithStats = TradeRow;

type RawPosition = Record<string, unknown> & {
  id: string;
  account_id: string | null;
  trade_no: number | null;
};

export async function getTradesWithStats(
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

  const [statRows, images] = await Promise.all([
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
        .select("position_id, kind, image_url")
        .in("position_id", chunk)
        .order("position_id")
        .range(from, to),
    ),
  ]);

  const imagesByPosition = new Map<string, TradeTvImages>();
  for (const img of images) {
    const kind = img.kind as TradeImageKind;
    const bucket = imagesByPosition.get(img.position_id) ?? {};
    bucket[kind] = img.image_url;
    imagesByPosition.set(img.position_id, bucket);
  }

  const statById = new Map<string, PositionStat>();
  for (const s of statRows as PositionStat[]) {
    if (s.position_id) statById.set(s.position_id, s);
  }

  return positions.map(
    (p) =>
      ({
        ...p,
        stats: statById.get(p.id) ?? null,
        tv_images: imagesByPosition.get(p.id) ?? {},
      }) as TradeRow,
  );
}

export async function getTradeForEdit(
  id: string,
): Promise<TradeFormInitial | null> {
  const supabase = await createClient();
  const [{ data: pos }, { data: execs }] = await Promise.all([
    supabase.from("tj_positions").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("tj_executions")
      .select("side,price,qty,executed_at,fee,swap_funding")
      .eq("position_id", id)
      .order("executed_at"),
  ]);
  if (!pos) return null;

  const { id: _id, account_id, trade_no, ...rest } = pos as RawPosition;
  // Keep only the dynamic field columns (sanitize handles the rest on save).
  //
  // The loop accepts strings, numbers and string arrays — an OBJECT falls
  // through it. `custom` is an object, so without the flatten below every
  // user-defined field would be dropped on the way into the form and then
  // written back empty on the next save. Flattening first puts those values on
  // the same flat record the form reads, and the column loop still wins for any
  // key that is both (see field-values.ts).
  // Custom keys first, columns spread over them, so a column keeps winning —
  // the same precedence `fieldValue` applies everywhere else.
  const flat: Record<string, unknown> = { ...flattenCustom(rest), ...rest };
  delete flat[CUSTOM_FIELD_COLUMN];

  const fields: Record<string, string | number | string[] | null> = {};
  for (const [k, v] of Object.entries(flat)) {
    if (v == null) continue;
    if (typeof v === "string" || typeof v === "number") fields[k] = v;
    if (Array.isArray(v)) fields[k] = v.filter((x) => typeof x === "string");
  }

  return {
    id,
    account_id: account_id ?? null,
    trade_no: trade_no ?? null,
    status: (pos as RawPosition & { status?: string }).status ?? "planned",
    missed_at: (pos as RawPosition & { missed_at?: string | null }).missed_at ?? null,
    fields,
    executions: (execs ?? []).map((e) => ({
      side: e.side as "entry" | "exit",
      price: Number(e.price),
      qty: Number(e.qty),
      executed_at: e.executed_at as string,
      fee: Number(e.fee),
      swap_funding: Number(e.swap_funding),
    })),
  };
}

/**
 * Number of entry and exit fills per position.
 *
 * `entry_qty` in the stats view is a quantity, not a count — a single 3-lot
 * fill and three 1-lot fills look identical there. Scale-in / scale-out
 * detection needs the row count, so it is fetched separately.
 */
export async function getFillCounts(): Promise<
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
