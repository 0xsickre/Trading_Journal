/**
 * The close of one trading day (phase B7, 26.10.2026), read from its trades:
 * the best and the worst one — the two a review opens first, and the two that
 * must carry a chart — and what each mistake cost that day.
 *
 * A mistake is the trader's own pick or one the journal found (`autoMistakes`),
 * counted once per trade whoever named it, as the reports count it. Money is
 * the trade's net; R its realized R net of costs where known, else gross.
 * Pure: the page passes the day's rows and the found mistakes.
 */
import type { AutoMistake } from "./auto-mistakes";
import { NO_MISTAKE } from "./quick-log";
import type { TradeRow } from "./types";

export type DayCloseTrade = {
  id: string;
  label: string;
  net: number;
  r: number | null;
  hasChart: boolean;
};

export type MistakeCost = {
  tag: string;
  trades: number;
  net: number;
  /** Sum of R over the trades that carry one; null when none does. */
  r: number | null;
  /** True when at least one trade got it from the journal rather than from the trader. */
  auto: boolean;
};

export type DayClose = {
  closed: number;
  best: DayCloseTrade | null;
  worst: DayCloseTrade | null;
  /** Most expensive first: by net, then by R. */
  mistakes: MistakeCost[];
};

const labelOf = (row: TradeRow) => (row.trade_no != null ? `#${row.trade_no}` : row.id.slice(0, 8));
const rOf = (row: TradeRow) => row.stats?.realized_r_net ?? row.stats?.realized_r ?? null;
const charts = (row: TradeRow) => {
  const v = (row as { chart_images?: unknown }).chart_images;
  return Array.isArray(v) ? v.length : 0;
};
const tagsOf = (row: TradeRow): string[] => {
  const v = (row as { mistake?: unknown }).mistake;
  return Array.isArray(v) ? v.map(String).filter((m) => m.trim() !== "" && m !== NO_MISTAKE) : [];
};

function asTrade(row: TradeRow): DayCloseTrade {
  return { id: row.id, label: labelOf(row), net: row.stats!.net_pl as number, r: rOf(row), hasChart: charts(row) > 0 };
}

export function dayClose(rows: readonly TradeRow[], found: ReadonlyMap<string, readonly AutoMistake[]>): DayClose {
  // Closed as the tracker reads it (`evalScreenshotPerTrade`: a close time and a
  // price), so the card and "Screenshotovi" name the same best and worst trade.
  const closed = rows.filter((r) => r.stats?.closed_at != null && r.stats?.net_pl != null);
  const net = (r: TradeRow) => r.stats!.net_pl as number;
  const best = closed.length > 0 ? closed.reduce((a, b) => (net(b) > net(a) ? b : a)) : null;
  const worst = closed.length > 0 ? closed.reduce((a, b) => (net(b) < net(a) ? b : a)) : null;

  const byTag = new Map<string, MistakeCost>();
  for (const row of closed) {
    const auto = (found.get(row.id) ?? []).map((m) => m.label as string);
    const tags = new Set([...tagsOf(row), ...auto]);
    for (const tag of tags) {
      const c = byTag.get(tag) ?? { tag, trades: 0, net: 0, r: null, auto: false };
      c.trades += 1;
      c.net += net(row);
      const r = rOf(row);
      if (r != null) c.r = (c.r ?? 0) + r;
      if (auto.includes(tag)) c.auto = true;
      byTag.set(tag, c);
    }
  }
  const mistakes = [...byTag.values()].sort((a, b) => a.net - b.net || (a.r ?? 0) - (b.r ?? 0));

  return {
    closed: closed.length,
    best: best ? asTrade(best) : null,
    worst: worst ? asTrade(worst) : null,
    mistakes,
  };
}
