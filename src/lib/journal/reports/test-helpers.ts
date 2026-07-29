import type { RealizedTrade } from "../analytics";
import { enrichTrades, type DailyReportLite } from "../enriched-trade";
import type { PositionStat, TradeRow } from "../types";
import { customFieldDimensions, type DimensionContext } from "./dimensions";
import type { MetricContext } from "./metrics";
import { EXACT_ZERO_RANGE } from "../breakeven";

export const DAY = 86_400;

export type TradeSpec = {
  id?: string;
  net?: number;
  gross?: number;
  r?: number | null;
  direction?: string;
  instrument?: string;
  setupGrade?: string;
  macroAlign?: string;
  status?: string;
  technicalTags?: string[];
  psychologyTags?: string[];
  size?: number | null;
  swap?: number;
  fees?: number;
  openedAt?: string;
  closedAt?: string;
  durationSeconds?: number | null;
  accountId?: string | null;
  plannedRr?: string | null;
  mae?: number | null;
  mfe?: number | null;
  /** Values for user-defined fields, as they are actually stored. */
  custom?: Record<string, unknown>;
};

let seq = 0;

export function mkTrade(spec: TradeSpec = {}): RealizedTrade {
  const id = spec.id ?? `t${++seq}`;
  const net = spec.net ?? 100;
  const closedAt = spec.closedAt ?? "2026-01-09T12:00:00Z";
  const openedAt = spec.openedAt ?? "2026-01-05T12:00:00Z";

  const stats: PositionStat = {
    position_id: id,
    avg_entry: 100,
    avg_exit: null,
    entry_qty: 1,
    exit_qty: 1,
    gross_pl: spec.gross ?? net,
    net_pl: net,
    total_fees: spec.fees ?? 0,
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
    account_id: spec.accountId ?? "acc-1",
    trade_no: null,
    status: spec.status ?? "closed",
    source: "manual",
    needs_review: false,
    created_at: openedAt,
    direction: spec.direction ?? "Long",
    entry_price: 100,
    stop_price: 90,
    max_drawdown_price: spec.mae ?? null,
    max_profit_price: spec.mfe ?? null,
    position_size: spec.size ?? null,
    setup_grade: spec.setupGrade ?? null,
    // macro_align is a USER-DEFINED field since Phase 4a, so the fixture stores
    // it where the real row does. Every test that groups by it therefore
    // exercises the custom-field path, not a column that no longer exists.
    custom: {
      ...(spec.macroAlign ? { macro_align: spec.macroAlign } : {}),
      ...spec.custom,
    },
    instrument: spec.instrument ?? "EURUSD",
    technical_tags: spec.technicalTags ?? [],
    psychology_tags: spec.psychologyTags ?? [],
    planned_rr: spec.plannedRr ?? null,
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

export function enrich(specs: TradeSpec[]) {
  return enrichTrades(specs.map(mkTrade), { tzOf: () => "UTC" });
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

/** The user-defined fields the fixtures use. */
export const TEST_FIELD_DEFS = [
  {
    key: "macro_align",
    label: "Macro Align",
    field_type: "select",
    list_key: "macro_align",
  },
];

export function dimCtx(
  reports: DailyReportLite[] = [],
  extra: Partial<DimensionContext> = {},
): DimensionContext {
  return {
    reportByDate: new Map(reports.map((r) => [r.report_date, r])),
    customDimensions: customFieldDimensions(TEST_FIELD_DEFS),
    ...extra,
  };
}

export const metricCtx: MetricContext = {
  pnlBasis: "net",
  range: EXACT_ZERO_RANGE,
  currency: "USD",
};
