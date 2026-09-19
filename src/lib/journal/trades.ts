import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { selectAllByIds, selectAllPages } from "@/lib/supabase/paginate";
import { CUSTOM_FIELD_COLUMN, flattenCustom } from "./field-values";
import { getTradeRuleAnswers } from "./playbooks";
import type { TradeFormInitial } from "@/components/journal/trade-form";
import type { TradeImageKind } from "./tradingview-snapshot";
import { narrowPositionStat } from "./types";
import type { PositionStat, TradeRow, TradeTvImages } from "./types";

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
        tv_images: imagesByPosition.get(p.id) ?? {},
      }) as TradeRow,
  );
}

// Memoized per request (React `cache`), like `getCurrentUser` and `getFieldDefs`: a page
// and the helpers it calls ask for this more than once in one render, and each ask
// was its own round trip to the database.
export const getTradesWithStats = cache(readTradesWithStats);

export async function getTradeForEdit(
  id: string,
): Promise<TradeFormInitial | null> {
  const supabase = await createClient();
  const [{ data: pos }, { data: execs }, ruleAnswers] = await Promise.all([
    supabase.from("tj_positions").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("tj_executions")
      .select("side,price,qty,executed_at,fee,swap_funding")
      .eq("position_id", id)
      .order("executed_at"),
    getTradeRuleAnswers(id),
  ]);
  if (!pos) return null;

  const { id: _id, account_id, trade_no, ...rest } = pos as RawPosition;
  // Keep only the dynamic field columns (sanitize handles the rest on save).
  //
  // The loop below accepts strings, numbers and string arrays — an OBJECT falls
  // through it. `custom` is an object, so without this flatten every
  // user-defined field would be dropped on the way into the form and then
  // written back empty on the next save.
  //
  // Custom keys first, columns spread over them, so a column keeps winning —
  // the same precedence `fieldValue` applies everywhere else.
  const flat: Record<string, unknown> = { ...flattenCustom(rest), ...rest };
  delete flat[CUSTOM_FIELD_COLUMN];
  // Not a form field: it is a jsonb array of objects, and the loop below would
  // reduce it to `[]` — inert, but it would sit in the bag looking like a value
  // the form could write back. It travels on its own key instead.
  delete flat.scale_out_levels;

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
    playbook_id: (pos as RawPosition & { playbook_id?: string | null }).playbook_id ?? null,
    scale_out_levels: (pos as RawPosition & { scale_out_levels?: unknown }).scale_out_levels ?? [],
    rule_answers: ruleAnswers,
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
