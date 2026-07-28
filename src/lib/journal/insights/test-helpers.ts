import type { RealizedTrade } from "../analytics";
import type { PositionStat, TradeRow } from "../types";
import { buildInsightContext, type DailyReportLite } from "./context";

export const DAY = 86_400;

export type TradeSpec = {
  id?: string;
  net?: number;
  gross?: number;
  r?: number | null;
  /** Long risk is entry−stop = 10 points by default. */
  entry?: number;
  stop?: number;
  mae?: number | null;
  mfe?: number | null;
  direction?: string;
  openedAt?: string;
  closedAt?: string;
  durationSeconds?: number | null;
  size?: number | null;
  swap?: number;
  setupGrade?: string;
  macroAlign?: string;
  cotFilter?: string;
  instrument?: string;
  tradeNo?: number;
};

let seq = 0;

export function mkTrade(spec: TradeSpec = {}): RealizedTrade {
  const id = spec.id ?? `t${++seq}`;
  const net = spec.net ?? 100;
  const entry = spec.entry ?? 100;
  const stop = spec.stop ?? 90;
  const closedAt = spec.closedAt ?? "2026-01-09T12:00:00Z";
  const openedAt = spec.openedAt ?? "2026-01-05T12:00:00Z";

  const stats: PositionStat = {
    position_id: id,
    avg_entry: entry,
    avg_exit: null,
    entry_qty: 1,
    exit_qty: 1,
    gross_pl: spec.gross ?? net,
    net_pl: net,
    total_fees: 0,
    total_swap: spec.swap ?? 0,
    realized_r: spec.r === undefined ? net / 100 : spec.r,
    realized_r_net: null,
    opened_at: openedAt,
    closed_at: closedAt,
    duration_seconds:
      spec.durationSeconds === undefined ? 4 * DAY : spec.durationSeconds,
    point_value: 1,
    tick_size: null,
    point_value_source: "snapshot",
  };

  const row = {
    id,
    account_id: "acc",
    trade_no: spec.tradeNo ?? null,
    status: "closed",
    source: "manual",
    needs_review: false,
    created_at: openedAt,
    direction: spec.direction ?? "Long",
    entry_price: entry,
    stop_price: stop,
    max_drawdown_price: spec.mae ?? null,
    max_profit_price: spec.mfe ?? null,
    position_size: spec.size ?? null,
    setup_grade: spec.setupGrade ?? null,
    macro_align: spec.macroAlign ?? null,
    cot_filter: spec.cotFilter ?? null,
    instrument: spec.instrument ?? "EURUSD",
    stats,
  } as unknown as TradeRow;

  return {
    id,
    closedAt,
    net,
    gross: spec.gross ?? net,
    r: stats.realized_r,
    row,
  };
}

export function mkReport(
  report_date: string,
  overrides: Partial<DailyReportLite> = {},
): DailyReportLite {
  return {
    report_date,
    micromanage: null,
    mental_temp: null,
    day_grade: null,
    rule_broken: null,
    no_trade_day: false,
    ...overrides,
  };
}

export function ctxOf(
  trades: RealizedTrade[],
  extra: {
    reports?: DailyReportLite[];
    allRows?: TradeRow[];
    fillCounts?: Map<string, { entries: number; exits: number }>;
  } = {},
) {
  return buildInsightContext({
    trades,
    tzOf: () => "UTC",
    reports: extra.reports,
    allRows: extra.allRows,
    fillCounts: extra.fillCounts,
    currency: "USD",
  });
}

/** Ids fired by a rule, for terse assertions. */
export function fired(
  rule: { evaluate: (c: ReturnType<typeof ctxOf>) => { subjectId: string }[] },
  ctx: ReturnType<typeof ctxOf>,
): string[] {
  return rule.evaluate(ctx).map((i) => i.subjectId);
}
