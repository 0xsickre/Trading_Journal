import type { RealizedTrade } from "../analytics";
import { enrichTrades, type DailyReportLite } from "../enriched-trade";
import type { PositionCheckin } from "../position-checkin";
import type { PositionStat, TradeRow } from "../types";
import { customFieldDimensions, type DimensionContext } from "./dimensions";
import { buildPlaybookLookup } from "./playbook-dimensions";
import type { RuleLookup } from "./rule-lookup";
import type { PositionRule } from "../playbook-types";
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
  mistake?: string[];
  executionRating?: number | null;
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
  /** The exit deadline written at entry, in sessions. */
  timeStopDays?: number | null;
  /** The reason for the trade, in writing. */
  thesis?: string | null;
  /** The playbook the trade was taken from — what a setup score is graded against. */
  playbookId?: string | null;
  /** Values for user-defined fields, as they are actually stored. */
  custom?: Record<string, unknown>;
  /**
   * Size entered, which is the multiplier on the risk taken. Default 1, with
   * the default entry/stop of 100/90 and a point value of 1, so the default
   * trade risks 10 — and at `equityAtEntry: 1000` that is a round 1 %.
   */
  entryQty?: number | null;
  /** The account's opening balance on the entry day, frozen on the row. */
  equityAtEntry?: number | null;
  /** The risk the trader chose, as the dropdown stores it ("1%"). */
  riskPct?: string | null;
};

let seq = 0;

/**
 * The playbook a fixture's `setupGrade` is graded against.
 *
 * Phase E dropped `tj_positions.setup_grade`: the letter is DERIVED from
 * playbook criteria and can no longer be typed onto the row. So a fixture
 * asking for a grade now has to produce one the real way — a playbook with
 * five criteria and answers that land on the band.
 *
 * Five criteria, because `gradeFromPct` bands on 100 / 80 / 60: five answers
 * can express every grade exactly (5, 4, 3, 1 met).
 */
export const GRADED_PLAYBOOK_ID = "pb-graded";
const GRADE_CRITERIA = ["gc1", "gc2", "gc3", "gc4", "gc5"];
const MET_FOR_GRADE: Record<string, number> = { "A+": 5, A: 4, B: 3, C: 1 };

/**
 * Trade id → the criterion answers `mkTrade` recorded for it.
 *
 * Module-level, so the ~25 call sites that pass `setupGrade` keep working and
 * `dimCtx()` can hand the engine a real rule lookup without every test wiring
 * one. Keyed by trade id, so a rebuilt fixture simply overwrites its own
 * entry; an id never reused leaves an orphan answer nothing reads.
 */
const gradeAnswers = new Map<string, PositionRule[]>();

/**
 * Record the answers that make `id` come out at `grade`.
 *
 * Exported because the insights fixtures need exactly the same thing, and two
 * graded playbooks would be two definitions of what an "A setup" is.
 */
export function recordGradeAnswers(id: string, grade: string): void {
  const met = MET_FOR_GRADE[grade] ?? 0;
  gradeAnswers.set(
    id,
    GRADE_CRITERIA.map((rule_id, i) => ({ position_id: id, rule_id, followed: i < met })),
  );
}

/** The lookup the dimension and the setup-score metric read. */
export function gradedRules(): RuleLookup {
  return buildPlaybookLookup(
    [
      {
        id: GRADED_PLAYBOOK_ID,
        name: "Graded",
        rules: GRADE_CRITERIA.map((id) => ({
          id,
          text: id,
          show_when: "always" as const,
          is_setup_criterion: true,
        })),
      },
    ],
    gradeAnswers,
  ).rules;
}

export function mkTrade(spec: TradeSpec = {}): RealizedTrade {
  const id = spec.id ?? `t${++seq}`;
  const net = spec.net ?? 100;
  const closedAt = spec.closedAt ?? "2026-01-09T12:00:00Z";
  const openedAt = spec.openedAt ?? "2026-01-05T12:00:00Z";

  const stats: PositionStat = {
    position_id: id,
    avg_entry: 100,
    avg_exit: null,
    entry_qty: spec.entryQty === undefined ? 1 : spec.entryQty,
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
    quote_currency: "USD",

    account_currency: "USD",

    fx_rate: 1,

    fx_rate_source: "same_currency",

    money_overridden: false,

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
    // `text[] NOT NULL DEFAULT '{}'` since the `mistake_multi` migration — an
    // empty array is what the database returns for a trade with no mistake,
    // never null.
    mistake: spec.mistake ?? [],
    execution_rating: spec.executionRating ?? null,
    planned_rr: spec.plannedRr ?? null,
    time_stop_days: spec.timeStopDays ?? null,
    thesis: spec.thesis ?? null,
    // A graded fixture names the graded playbook, unless it named its own.
    playbook_id: spec.playbookId ?? (spec.setupGrade ? GRADED_PLAYBOOK_ID : null),
    equity_at_entry: spec.equityAtEntry ?? null,
    risk_pct: spec.riskPct ?? null,
    stats,
  } as unknown as TradeRow;

  if (spec.setupGrade) recordGradeAnswers(id, spec.setupGrade);

  return {
    id,
    closedAt,
    net,
    gross: spec.gross ?? net,
    r: stats.realized_r,
    row,
  };
}

/**
 * `tz` defaults to UTC so day keys equal the ISO prefix and fixtures stay
 * readable. Pass a real zone to exercise the boundary cases — a close instant
 * that falls on a different calendar day in the account's timezone than in UTC.
 */
export function enrich(specs: TradeSpec[], tz = "UTC") {
  return enrichTrades(specs.map(mkTrade), { tzOf: () => tz });
}

export function mkReport(
  report_date: string,
  overrides: Partial<DailyReportLite> = {},
): DailyReportLite {
  return {
    report_date,
    mental_temp: null,
    no_trade_day: false,
    ...overrides,
  };
}

/**
 * A position's check-in for one day.
 *
 * `position_id` is the trade id, because that is the join — the whole reason
 * these rows exist is that "did I touch it" is a fact about a position and not
 * about a day.
 */
export function mkCheckin(
  position_id: string,
  report_date: string,
  overrides: Partial<PositionCheckin> = {},
): PositionCheckin {
  return {
    id: `${position_id}-${report_date}`,
    position_id,
    report_date,
    thesis_state: null,
    touched: null,
    note: null,
    ...overrides,
  };
}

/** Check-ins bucketed the way `DimensionContext` wants them. */
export function byPosition(
  checkins: PositionCheckin[],
): Map<string, PositionCheckin[]> {
  const out = new Map<string, PositionCheckin[]>();
  for (const c of checkins) {
    const list = out.get(c.position_id);
    if (list) list.push(c);
    else out.set(c.position_id, [c]);
  }
  return out;
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
    // The graded playbook by default, so `setupGrade` in a spec still produces
    // a grade — through the criteria, which is the only route left.
    rules: gradedRules(),
    ...extra,
  };
}

export const metricCtx: MetricContext = {
  pnlBasis: "net",
  range: EXACT_ZERO_RANGE,

};
