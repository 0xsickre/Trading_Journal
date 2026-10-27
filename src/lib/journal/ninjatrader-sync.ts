/**
 * The NinjaTrader sync (phase I3, 27.10.2026): fills and orders read straight
 * from `NinjaTrader.sqlite` on the trader's PC every five minutes, posted to
 * `/api/import/ninjatrader`, and written through the same import path as
 * `/import`.
 *
 * The PC script only reads and translates NinjaTrader's numbers (enums, .NET
 * ticks) into the plain shapes below. Everything that decides what a trade IS —
 * where it starts and ends, its stop, its target, how it ended — lives here,
 * pure and tested, so there is one place that computes it.
 *
 * WHAT NINJATRADER STORES, AND WHAT IS READ FROM IT
 *
 *   - Each fill with its own id (`ExecutionId`), time in UTC, side, size and
 *     price. The same fills arrive on every run (the script sends the last 14
 *     days), so the id is what makes a second run write nothing.
 *   - Each order, and every change to it (`OrderUpdates`). The FIRST stop price
 *     a stop order had is the stop the risk was taken with — the one a moved
 *     stop hides, and the reason this beats a statement, which only knows the
 *     last price.
 *   - No commission (0 on the fills): the fee comes from the instrument's
 *     commission per lot in Settings › Instruments.
 */
import type { ImportExec, ImportItem } from "@/app/(app)/import/actions";
import { matchImportRow, type MatchCandidate } from "./import-match";

export type NtFill = {
  id: string;
  order_id: string;
  /** UTC ISO. */
  time: string;
  /** The contract, e.g. MNQZ6. */
  instrument: string;
  side: "buy" | "sell";
  qty: number;
  price: number;
};

export type NtOrder = {
  id: string;
  instrument: string;
  side: "buy" | "sell";
  type: "limit" | "market" | "stop" | "stop_limit" | "other";
  /** UTC ISO: when the order was placed. */
  time: string;
  limit_price: number | null;
  /** The stop price as it stands now (the last one). */
  stop_price: number | null;
  /** The stop price the order was placed with, from its update history. */
  first_stop_price: number | null;
};

export type NtPayload = {
  /** The account's name in NinjaTrader — `tj_accounts.platform_account`. */
  account: string;
  fills: NtFill[];
  orders: NtOrder[];
};

export type NtTrade = {
  /** The first entry fill's id: the trade's identity across runs. */
  key: string;
  instrument: string;
  direction: "Long" | "Short";
  fills: (Omit<ImportExec, "fee"> & { external_id: string })[];
  open: boolean;
  stop_price: number | null;
  final_stop_price: number | null;
  target_price: number | null;
  entry_order_type: "market" | "limit" | "stop" | null;
  exit_kind: "stop" | "target" | "manual" | null;
};

const EPS = 1e-9;
const at = (iso: string) => Date.parse(iso);

/**
 * The fills, cut into trades: flat → in a position → flat, per contract. A fill
 * that goes through flat (sell 3 when long 2) closes the trade with part of it
 * and opens the next with the rest — two fills with ids `id` and `id#2`.
 */
export function ntTrades(fills: readonly NtFill[], orders: readonly NtOrder[]): NtTrade[] {
  const byInstrument = new Map<string, NtFill[]>();
  for (const f of fills) {
    if (!(f.qty > 0) || !(f.price > 0) || Number.isNaN(at(f.time))) continue;
    byInstrument.set(f.instrument, [...(byInstrument.get(f.instrument) ?? []), f]);
  }
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const out: NtTrade[] = [];

  for (const [instrument, list] of byInstrument) {
    list.sort((a, b) => at(a.time) - at(b.time) || a.id.localeCompare(b.id));
    let pos = 0;
    let cur: { direction: "Long" | "Short"; fills: NtTrade["fills"]; raw: NtFill[] } | null = null;
    const close = (open: boolean) => {
      if (cur) out.push(finish(instrument, cur.direction, cur.fills, cur.raw, open, orders, orderById));
      cur = null;
    };
    for (const f of list) {
      const signed = f.side === "buy" ? f.qty : -f.qty;
      let rest = f.qty;
      let suffix = "";
      while (rest > EPS) {
        if (Math.abs(pos) < EPS) {
          cur = { direction: signed > 0 ? "Long" : "Short", fills: [], raw: [] };
          cur.fills.push({ side: "entry", price: f.price, qty: rest, executed_at: f.time, external_id: f.id + suffix });
          cur.raw.push(f);
          pos = signed > 0 ? rest : -rest;
          rest = 0;
        } else if ((pos > 0) === signed > 0) {
          cur!.fills.push({ side: "entry", price: f.price, qty: rest, executed_at: f.time, external_id: f.id + suffix });
          cur!.raw.push(f);
          pos += signed > 0 ? rest : -rest;
          rest = 0;
        } else {
          const take = Math.min(rest, Math.abs(pos));
          cur!.fills.push({ side: "exit", price: f.price, qty: take, executed_at: f.time, external_id: f.id + suffix });
          cur!.raw.push(f);
          pos += pos > 0 ? -take : take;
          rest -= take;
          if (Math.abs(pos) < EPS) {
            pos = 0;
            close(false);
            suffix = "#2";
          }
        }
      }
    }
    if (cur) close(true);
  }
  return out.sort((a, b) => at(a.fills[0].executed_at) - at(b.fills[0].executed_at));
}

function finish(
  instrument: string,
  direction: "Long" | "Short",
  fills: NtTrade["fills"],
  raw: NtFill[],
  open: boolean,
  orders: readonly NtOrder[],
  orderById: ReadonlyMap<string, NtOrder>,
): NtTrade {
  const long = direction === "Long";
  const start = at(fills[0].executed_at);
  const end = open ? Infinity : at(fills[fills.length - 1].executed_at);
  const exitSide: NtOrder["side"] = long ? "sell" : "buy";
  const entryAvg = avg(fills.filter((f) => f.side === "entry"));
  // The bracket: orders on the other side, placed while the trade was on. An
  // order placed a second before the entry fill belongs to it (an ATM bracket
  // is sent with the entry), so the window opens a minute early.
  const bracket = orders
    .filter((o) => o.instrument === instrument && o.side === exitSide)
    .filter((o) => at(o.time) >= start - 60_000 && at(o.time) <= end)
    .sort((a, b) => at(a.time) - at(b.time));
  const stops = bracket.filter((o) => o.type === "stop" || o.type === "stop_limit");
  const targets = bracket.filter(
    (o) => o.type === "limit" && o.limit_price != null && (long ? o.limit_price > entryAvg : o.limit_price < entryAvg),
  );
  const firstStop = stops[0] ?? null;
  const lastStop = stops[stops.length - 1] ?? null;

  const entryOrder = orderById.get(raw[0].order_id);
  const exitFill = open ? null : raw[raw.length - 1];
  const exitOrder = exitFill ? orderById.get(exitFill.order_id) : undefined;

  return {
    key: fills[0].external_id,
    instrument,
    direction,
    fills,
    open,
    stop_price: firstStop ? (firstStop.first_stop_price ?? firstStop.stop_price) : null,
    final_stop_price: lastStop?.stop_price ?? null,
    target_price: targets.length ? targets[targets.length - 1].limit_price : null,
    entry_order_type: !entryOrder
      ? null
      : entryOrder.type === "market"
        ? "market"
        : entryOrder.type === "limit"
          ? "limit"
          : entryOrder.type === "stop" || entryOrder.type === "stop_limit"
            ? "stop"
            : null,
    exit_kind: !exitFill
      ? null
      : exitOrder?.type === "stop" || exitOrder?.type === "stop_limit"
        ? "stop"
        : exitOrder?.type === "limit"
          ? "target"
          : "manual",
  };
}

function avg(fills: readonly { price: number; qty: number }[]): number {
  const q = fills.reduce((s, f) => s + f.qty, 0);
  return q > 0 ? fills.reduce((s, f) => s + f.price * f.qty, 0) / q : 0;
}

/** The trade's stop sits at or beyond its entry on the profit side. */
function stopInProfit(t: NtTrade): boolean {
  if (t.final_stop_price == null) return false;
  const entry = avg(t.fills.filter((f) => f.side === "entry"));
  return t.direction === "Long" ? t.final_stop_price >= entry : t.final_stop_price <= entry;
}

/**
 * What the import writes for each trade.
 *
 *   - Every fill already in the journal (by id), all on one trade → nothing to
 *     do, unless the trade has a fill the journal does not have yet (a position
 *     that was open on the last run and has closed since): then those fills are
 *     merged into it.
 *   - None known → the same match `/import` makes (decision I-8: an existing
 *     trade of the same contract, side, size and time within 10 minutes is
 *     MERGED into, not doubled). Anything less certain is created.
 *   - Fills of one trade spread over several journal trades → skipped and
 *     reported: merging would delete the fills of the others.
 */
export function ntImportItems(
  trades: readonly NtTrade[],
  known: ReadonlyMap<string, string>,
  candidates: readonly MatchCandidate[],
  accountId: string,
  feePerLot: (instrument: string) => number,
  instrumentsMatch: (a: string, b: string) => boolean,
): { items: ImportItem[]; skipped: { key: string; reason: string }[] } {
  const items: ImportItem[] = [];
  const skipped: { key: string; reason: string }[] = [];
  for (const t of trades) {
    const fee = feePerLot(t.instrument);
    const executions: ImportExec[] = t.fills.map((f) => ({ ...f, fee: Math.round(fee * f.qty * 100) / 100 }));
    const positions = new Set(t.fills.map((f) => known.get(f.external_id)).filter((p): p is string => p != null));
    const unknownFills = t.fills.filter((f) => !known.has(f.external_id)).length;
    const base = {
      instrument: t.instrument,
      direction: t.direction,
      executions,
      gross_pnl_override: null,
      target_price: t.target_price,
      stop_price: t.stop_price,
      final_stop_price: t.final_stop_price,
      entry_order_type: t.entry_order_type,
      exit_kind: t.exit_kind,
      stop_moved_to_profit: stopInProfit(t),
      raw: { source: "ninjatrader", key: t.key },
    };
    if (positions.size > 1) {
      skipped.push({ key: t.key, reason: "fill-ovi ovog trejda su na više trejdova u journalu" });
      continue;
    }
    if (positions.size === 1) {
      if (unknownFills === 0) continue;
      items.push({ ...base, decision: "merge", match_status: "match", matched_position_id: [...positions][0] });
      continue;
    }
    const entries = executions.filter((e) => e.side === "entry");
    const exits = executions.filter((e) => e.side === "exit");
    const outcome = matchImportRow(
      {
        instrument: t.instrument,
        direction: t.direction,
        entryPrice: avg(entries),
        entryTime: entries[0].executed_at,
        entryQty: entries.reduce((s, e) => s + e.qty, 0),
        exitPrice: exits.length ? avg(exits) : null,
        accountId,
      },
      candidates,
      instrumentsMatch,
    );
    // Only a full match is merged unattended. A `suggested` one (time apart) is
    // a guess the wizard asks a human about; with nobody to ask, it is created.
    if (outcome.matched && outcome.status === "match") {
      items.push({ ...base, decision: "merge", match_status: "match", matched_position_id: outcome.matched.id });
    } else {
      items.push({
        ...base,
        decision: "create",
        match_status: outcome.status === "ambiguous" ? "ambiguous" : "new",
        matched_position_id: null,
      });
    }
  }
  return { items, skipped };
}
