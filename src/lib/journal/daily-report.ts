import { formatInTimeZone } from "date-fns-tz";
import { addDays, format, parseISO, subDays } from "date-fns";
import type { FocusGoal } from "./focus-goal";

export const DAY_GRADES = ["A", "B", "C", "D", "E", "F"] as const;
export type DayGrade = (typeof DAY_GRADES)[number];

export const MICROMANAGE_OPTIONS = [
  "untouched",
  "watched",
  "violated",
] as const;
export type Micromanage = (typeof MICROMANAGE_OPTIONS)[number];

export const MARKET_TYPES = [
  "bull_quiet",
  "bull_volatile",
  "bear_quiet",
  "bear_volatile",
  "sideways_quiet",
  "sideways_volatile",
] as const;
export type MarketType = (typeof MARKET_TYPES)[number];

export const MARKET_TYPE_LABELS: Record<MarketType, string> = {
  bull_quiet: "Bik · Mirno",
  bull_volatile: "Bik · Volatilno",
  bear_quiet: "Medved · Mirno",
  bear_volatile: "Medved · Volatilno",
  sideways_quiet: "Bočno · Mirno",
  sideways_volatile: "Bočno · Volatilno",
};

export const MICROMANAGE_LABELS: Record<Micromanage, string> = {
  untouched: "Nisam dirao",
  watched: "Pratio sam",
  violated: "Prekršio sam",
};

export type DailyReport = {
  id: string;
  user_id: string;
  report_date: string;
  day_grade: DayGrade | null;
  mental_temp: number | null;
  sleep_quality: number | null;
  macro_note: string | null;
  mantra_series: boolean;
  mantra_rules: boolean;
  mantra_risk: boolean;
  risk_accepted: boolean;
  mental_rehearsal: string | null;
  market_type: MarketType | null;
  micromanage: Micromanage | null;
  impulse_fomo: boolean;
  impulse_fear: boolean;
  impulse_greed: boolean;
  impulse_fear_wrong: boolean;
  impulse_note: string | null;
  rule_broken: boolean | null;
  rule_broken_note: string | null;
  learned_today: string | null;
  tomorrow_change: string | null;
  easiest_setup: string | null;
  day_overview: string | null;
  celebrate_win: string | null;
  friday_flat: boolean | null;
  no_trade_day: boolean;
  created_at: string;
  updated_at: string;
};

export type DailyReportInput = Omit<
  DailyReport,
  "id" | "user_id" | "created_at" | "updated_at"
>;

export function todayInTz(timezone: string): string {
  return formatInTimeZone(new Date(), timezone, "yyyy-MM-dd");
}

function formatDate(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

export function prevReportDate(date: string): string {
  return formatDate(subDays(parseISO(date), 1));
}

export function nextReportDate(date: string): string {
  return formatDate(addDays(parseISO(date), 1));
}

export function isFriday(date: string): boolean {
  return parseISO(date).getDay() === 5;
}

/** Complete when grade + rule-broken answered and an active focus goal exists. */
export function isReportComplete(
  report: Pick<DailyReport, "day_grade" | "rule_broken"> | null,
  activeGoal: FocusGoal | null,
): boolean {
  if (!activeGoal) return false;
  if (!report) return false;
  return report.day_grade != null && report.rule_broken != null;
}

export function emptyDailyReport(reportDate: string): DailyReportInput {
  return {
    report_date: reportDate,
    day_grade: null,
    mental_temp: null,
    sleep_quality: null,
    macro_note: null,
    mantra_series: false,
    mantra_rules: false,
    mantra_risk: false,
    risk_accepted: false,
    mental_rehearsal: null,
    market_type: null,
    micromanage: null,
    impulse_fomo: false,
    impulse_fear: false,
    impulse_greed: false,
    impulse_fear_wrong: false,
    impulse_note: null,
    rule_broken: null,
    rule_broken_note: null,
    learned_today: null,
    tomorrow_change: null,
    easiest_setup: null,
    day_overview: null,
    celebrate_win: null,
    friday_flat: null,
    no_trade_day: false,
  };
}
