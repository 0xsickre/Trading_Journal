import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { commitImport } from "@/app/(app)/import/actions";
import { getInstruments } from "@/lib/journal/instruments";
import { importCandidates } from "@/lib/journal/import-candidates";
import { instrumentsMatch, normalizeInstrumentSymbol } from "@/lib/journal/instrument-aliases";
import { ntEntryNameUpdates, ntImportItems, ntTrades, type NtPayload, type NtTrade } from "@/lib/journal/ninjatrader-sync";
import { getTradesWithStats } from "@/lib/journal/trades";
import { selectAllByIds } from "@/lib/supabase/paginate";
import type { TradeRow } from "@/lib/journal/types";

/**
 * POST /api/import/ninjatrader — the NinjaTrader sync (phase I3).
 *
 * The script on the trader's PC (`futures-trading/tools/nt_sync.py`) posts the
 * fills and orders of one NinjaTrader account every five minutes, with the
 * user's Supabase access token as `Authorization: Bearer`. Everything runs as
 * that user (RLS), through the same write path as `/import`. Sending the same
 * fills again writes nothing: each fill carries its NinjaTrader id.
 *
 * Beside the import (phase TR), each trade's position gets the name of its entry
 * order once (`platform_entry_name`): "RP Ulaz <id>" ties it to the Trejd
 * panel's log of that entry, any other name marks it as taken outside Trejd.
 */

const iso = z.iso.datetime({ offset: true });
const num = z.number().finite();
const payloadSchema = z.object({
  account: z.string().trim().min(1).max(100),
  fills: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        order_id: z.string().max(100),
        time: iso,
        instrument: z.string().min(1).max(40),
        side: z.enum(["buy", "sell"]),
        qty: num.positive(),
        price: num.positive(),
      }),
    )
    .max(5000),
  orders: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        instrument: z.string().min(1).max(40),
        side: z.enum(["buy", "sell"]),
        type: z.enum(["limit", "market", "stop", "stop_limit", "other"]),
        time: iso,
        limit_price: num.positive().nullable(),
        stop_price: num.positive().nullable(),
        first_stop_price: num.positive().nullable(),
        name: z.string().max(100).optional(),
      }),
    )
    .max(10000),
});

const json = (status: number, body: Record<string, unknown>) => Response.json(body, { status });

export async function POST(request: Request) {
  const bearer = request.headers.get("authorization") ?? "";
  const token = bearer.toLowerCase().startsWith("bearer ") ? bearer.slice(7).trim() : "";
  if (!token) return json(401, { ok: false, error: "Nedostaje Authorization: Bearer <token>." });

  const supabase = await createClient();
  // A malformed token makes getClaims THROW (it decodes before it verifies),
  // which answered 500 for what is plainly a bad credential.
  const claims = await supabase.auth.getClaims(token).then(
    ({ data, error }) => (error ? null : data),
    () => null,
  );
  if (!claims?.claims?.sub) return json(401, { ok: false, error: "Token nije važeći." });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { ok: false, error: "Telo zahteva nije JSON." });
  }
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) return json(400, { ok: false, error: parsed.error.issues[0]?.message ?? "Neispravan zahtev." });
  const payload: NtPayload = parsed.data;

  const { data: account, error: accError } = await supabase
    .from("tj_accounts")
    .select("id")
    .eq("platform_account", payload.account)
    .maybeSingle();
  if (accError) return json(500, { ok: false, error: accError.message });
  if (!account) {
    return json(404, {
      ok: false,
      error: `Nijedan nalog u journalu nema „Nalog u platformi“ = ${payload.account} (Settings › Accounts).`,
    });
  }

  const trades = ntTrades(payload.fills, payload.orders);
  if (trades.length === 0) return json(200, { ok: true, trades: 0, created: 0, merged: 0, unchanged: 0, skipped: [] });

  // Which of these fills the journal already has, and on which trade.
  const ids = trades.flatMap((t) => t.fills.map((f) => f.external_id));
  let knownRows: { external_id: string | null; position_id: string }[];
  try {
    knownRows = await selectAllByIds<{ external_id: string | null; position_id: string }, string>(ids, (chunk, from, to) =>
      supabase
        .from("tj_executions")
        .select("external_id, position_id, id")
        .in("external_id", chunk)
        .order("id")
        .range(from, to),
    );
  } catch (e) {
    return json(500, { ok: false, error: e instanceof Error ? e.message : String(e) });
  }
  const known = new Map(knownRows.filter((r) => r.external_id).map((r) => [r.external_id as string, r.position_id]));

  const [instruments, book] = await Promise.all([getInstruments(), getTradesWithStats()]);
  const perLot = new Map(instruments.map((i) => [i.symbol, Number(i.commission_per_lot ?? 0)]));
  const candidates = importCandidates((book as TradeRow[]).filter((t) => t.account_id === account.id));
  const { items, skipped } = ntImportItems(
    trades,
    known,
    candidates,
    account.id,
    (symbol) => perLot.get(normalizeInstrumentSymbol(symbol) ?? "") ?? 0,
    instrumentsMatch,
  );
  const unchanged = trades.length - items.length - skipped.length;
  if (items.length === 0) {
    const named = await stampEntryNames(supabase, trades);
    return json(200, { ok: true, trades: trades.length, created: 0, merged: 0, unchanged, skipped, ...named });
  }

  const result = await commitImport({
    account_id: account.id,
    filename: `NinjaTrader ${payload.account}`,
    items,
  });
  if (!result.ok) return json(500, { ok: false, error: result.error });
  // After the import, so a trade created by this very run is named on it.
  const named = await stampEntryNames(supabase, trades);
  return json(200, {
    ok: true,
    ...named,
    trades: trades.length,
    created: result.created,
    merged: result.merged,
    failed: result.failed,
    errors: result.errors,
    unchanged,
    skipped,
  });
}

/**
 * Phase TR: the entry order's name onto each trade's position, once, while the
 * position has none. Apart from the import on purpose: it changes no figure,
 * so an undo of the import has nothing of it to restore. A failure here never
 * fails the import that already went through: it is reported (`named_error`)
 * and the next run, five minutes on, tries again.
 */
async function stampEntryNames(
  supabase: Awaited<ReturnType<typeof createClient>>,
  trades: readonly NtTrade[],
): Promise<{ named: number; named_error?: string }> {
  const named = trades.filter((t) => t.entry_name != null);
  if (named.length === 0) return { named: 0 };
  try {
    const fills = await selectAllByIds<{ external_id: string | null; position_id: string }, string>(
      named.map((t) => t.key),
      (chunk, from, to) =>
        supabase
          .from("tj_executions")
          .select("external_id, position_id, id")
          .in("external_id", chunk)
          .order("id")
          .range(from, to),
    );
    const byFill = new Map(fills.filter((r) => r.external_id).map((r) => [r.external_id as string, r.position_id]));
    const positions = await selectAllByIds<{ id: string; platform_entry_name: string | null }, string>(
      [...new Set(byFill.values())],
      (chunk, from, to) =>
        supabase.from("tj_positions").select("id, platform_entry_name").in("id", chunk).order("id").range(from, to),
    );
    const updates = ntEntryNameUpdates(named, byFill, new Map(positions.map((p) => [p.id, p.platform_entry_name])));
    for (const u of updates) {
      const { error } = await supabase
        .from("tj_positions")
        .update({ platform_entry_name: u.name })
        .eq("id", u.position_id)
        .is("platform_entry_name", null);
      if (error) throw new Error(error.message);
    }
    return { named: updates.length };
  } catch (e) {
    return { named: 0, named_error: e instanceof Error ? e.message : String(e) };
  }
}
