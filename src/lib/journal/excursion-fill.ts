import "server-only";
import { createClient } from "@/lib/supabase/server";
import { DUKASCOPY_INSTRUMENTS, type FeedCandle } from "./dukascopy";
import { fetchMinuteCandles } from "./dukascopy-fetch";
import { excursionFromFeed, type FeedFill } from "./excursion-feed";

/**
 * Fill MAE/MFE for closed trades on BACKTEST accounts, from Dukascopy.
 *
 * Which trades, and why each exclusion:
 *
 *   - account_kind = 'backtest' only. A trading account's extremes will come
 *     from the broker's own MT5 terminal; a third-party feed next to live fills
 *     would be a second opinion presented as the record.
 *   - closed only. An open trade has no last exit to scan up to.
 *   - never over a MANUAL value. `excursion_source = 'manual'`, or prices present
 *     with no source at all (typed before the column existed), are the trader's
 *     and stay. A value this wrote before ('dukascopy') is recomputed — fills
 *     can be corrected, and the extremes have to follow them.
 *   - only instruments whose Dukascopy scale was verified (`dukascopy.ts`).
 *
 * Every trade that is skipped is named with its reason, so "nothing happened"
 * is never the whole answer.
 */

export type ExcursionFillReport = {
  filled: number;
  skipped: { tradeNo: number | null; instrument: string | null; reason: string }[];
};

type PositionRow = {
  id: string;
  trade_no: number | null;
  instrument: string | null;
  direction: string | null;
  status: string;
  account_id: string | null;
  max_drawdown_price: number | null;
  max_profit_price: number | null;
  excursion_source: string | null;
};

export async function fillExcursionsFromFeed(scope: {
  positionIds?: string[];
  accountId?: string;
}): Promise<ExcursionFillReport> {
  const report: ExcursionFillReport = { filled: 0, skipped: [] };
  const supabase = await createClient();

  const { data: accounts } = await supabase
    .from("tj_accounts")
    .select("id, account_kind");
  const backtest = new Set(
    (accounts ?? []).filter((a) => a.account_kind === "backtest").map((a) => a.id),
  );
  if (backtest.size === 0) return report;

  let query = supabase
    .from("tj_positions")
    .select(
      "id, trade_no, instrument, direction, status, account_id, max_drawdown_price, max_profit_price, excursion_source",
    )
    .in("account_id", [...backtest]);
  if (scope.positionIds) {
    if (scope.positionIds.length === 0) return report;
    query = query.in("id", scope.positionIds);
  }
  if (scope.accountId) query = query.eq("account_id", scope.accountId);
  const { data: positions, error } = await query;
  if (error || !positions) return report;

  const cache = new Map<string, FeedCandle[]>();

  for (const p of positions as PositionRow[]) {
    const skip = (reason: string) =>
      report.skipped.push({ tradeNo: p.trade_no, instrument: p.instrument, reason });

    if (p.status !== "closed") {
      skip("not closed yet");
      continue;
    }
    const typed =
      p.excursion_source === "manual" ||
      (p.excursion_source == null &&
        (p.max_drawdown_price != null || p.max_profit_price != null));
    if (typed) {
      skip("MAE/MFE was entered by hand — kept");
      continue;
    }
    const feed = p.instrument ? DUKASCOPY_INSTRUMENTS[p.instrument] : undefined;
    if (!feed) {
      skip(`no verified Dukascopy mapping for ${p.instrument ?? "this instrument"}`);
      continue;
    }

    const { data: execs } = await supabase
      .from("tj_executions")
      .select("side, price, executed_at")
      .eq("position_id", p.id);
    const fills: FeedFill[] = (execs ?? [])
      .filter((e) => e.side === "entry" || e.side === "exit")
      .map((e) => ({
        side: e.side as "entry" | "exit",
        price: Number(e.price),
        at: new Date(e.executed_at).getTime(),
      }))
      .filter((f) => Number.isFinite(f.price) && Number.isFinite(f.at));
    if (fills.length < 2) {
      skip("no entry and exit fills to measure between");
      continue;
    }

    try {
      const from = Math.min(...fills.map((f) => f.at));
      // Four hours past the last fill: the longest bar a fill time can have been
      // snapped to (`inferBarMs`), whose minutes the exit may lie in.
      const to = Math.max(...fills.map((f) => f.at)) + 4 * 3_600_000;
      const candles = await fetchMinuteCandles(feed.code, feed.scale, from, to, cache);
      const result = excursionFromFeed({
        fills,
        isShort: (p.direction ?? "").toLowerCase().startsWith("short"),
        candles,
        maxBasis: feed.maxBasis,
      });
      if (!result.ok) {
        skip(result.reason);
        continue;
      }
      const { error: upErr } = await supabase
        .from("tj_positions")
        .update({
          max_drawdown_price: result.maePrice,
          max_profit_price: result.mfePrice,
          excursion_source: "dukascopy",
        })
        .eq("id", p.id);
      if (upErr) skip(upErr.message);
      else report.filled++;
    } catch (e) {
      skip(e instanceof Error ? e.message : String(e));
    }
  }

  return report;
}
