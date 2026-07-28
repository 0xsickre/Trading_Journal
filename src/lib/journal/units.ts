/**
 * Unit and formatting layer.
 *
 * Seven view modes times two P&L bases is fourteen ways to render the same
 * metric. If each widget formatted its own numbers that combinatorics would be
 * copy-pasted everywhere, so the rule is: **metrics return a base value plus
 * the context needed to convert it, and only this module turns that into text.**
 *
 * A view mode is a request, not a guarantee. A trade count has no dollar
 * representation and a portfolio aggregate spanning several instruments has no
 * pip representation. When a conversion is impossible this module falls back to
 * the value's natural unit rather than inventing a number — `canRender` exposes
 * that so a UI can grey out a mode instead of silently showing something else.
 */

import { fmtMoney, fmtNum, fmtPct, fmtR } from "./format";

export type MetricUnit =
  | "money"
  | "r"
  | "pct"
  | "points"
  | "count"
  | "seconds"
  | "ratio";

export type ViewMode =
  | "dollars"
  | "percentage"
  | "r"
  | "ticks"
  | "pips"
  | "points"
  | "privacy";

export const VIEW_MODES: { value: ViewMode; label: string }[] = [
  { value: "dollars", label: "$" },
  { value: "percentage", label: "%" },
  { value: "r", label: "R" },
  { value: "points", label: "Points" },
  { value: "ticks", label: "Ticks" },
  { value: "pips", label: "Pips" },
  { value: "privacy", label: "Privacy" },
];

export type InstrumentContext = {
  symbol?: string;
  asset_class?: string | null;
  point_value?: number | null;
  tick_size?: number | null;
};

export type MetricContext = {
  currency?: string;
  /** Denominator for percentage mode — account equity, not starting balance. */
  equityBase?: number | null;
  /** Denominator for R mode — planned risk in money. */
  riskMoney?: number | null;
  /** Only set when the whole value belongs to ONE instrument. */
  instrument?: InstrumentContext | null;
};

export type MetricValue = {
  base: number | null;
  unit: MetricUnit;
  ctx?: MetricContext;
};

export function metric(
  base: number | null | undefined,
  unit: MetricUnit,
  ctx?: MetricContext,
): MetricValue {
  return { base: base ?? null, unit, ctx };
}

const MASK = "•••";

/**
 * Pip size for a forex instrument. Brokers quote most pairs to 5 decimals and
 * JPY pairs to 3, where one pip is ten ticks. Non-forex instruments have no
 * pip and return null so the caller falls back instead of guessing.
 */
export function pipSize(instrument: InstrumentContext | null | undefined): number | null {
  if (!instrument) return null;
  const cls = (instrument.asset_class ?? "").toLowerCase();
  if (cls !== "forex") return null;
  const tick = instrument.tick_size;
  if (tick == null || !(tick > 0)) return null;
  return tick * 10;
}

/** Whether `mode` can actually be rendered for this value. */
export function canRender(v: MetricValue, mode: ViewMode): boolean {
  if (mode === "privacy" || mode === "dollars") return true;
  // Unit-less quantities ignore the mode entirely; they always render.
  if (v.unit === "count" || v.unit === "seconds" || v.unit === "ratio") return true;
  if (v.unit === "pct" || v.unit === "r") return true;

  const ctx = v.ctx ?? {};
  switch (mode) {
    case "percentage":
      return (ctx.equityBase ?? 0) > 0;
    case "r":
      return (ctx.riskMoney ?? 0) > 0;
    case "points":
      return v.unit === "points" || (ctx.instrument?.point_value ?? 0) > 0;
    case "ticks":
      return (
        (ctx.instrument?.point_value ?? 0) > 0 &&
        (ctx.instrument?.tick_size ?? 0) > 0
      );
    case "pips":
      return (ctx.instrument?.point_value ?? 0) > 0 && pipSize(ctx.instrument) != null;
    default:
      return true;
  }
}

export function formatMetric(v: MetricValue, mode: ViewMode = "dollars"): string {
  if (v.base == null || Number.isNaN(v.base)) return "—";

  // Quantities that carry no monetary meaning are shown as-is in every mode —
  // hiding a trade count behind privacy mode would be theatre, not privacy.
  switch (v.unit) {
    case "count":
      return fmtNum(v.base, 0);
    case "seconds":
      return formatDuration(v.base);
    case "ratio":
      return fmtNum(v.base, 2);
    case "pct":
      return mode === "privacy" ? MASK : fmtPct(v.base);
    case "r":
      return mode === "privacy" ? MASK : fmtR(v.base);
  }

  if (mode === "privacy") return MASK;

  const ctx = v.ctx ?? {};
  const currency = ctx.currency ?? "USD";

  if (v.unit === "points") {
    // Already points; only tick/pip rescaling applies.
    const inst = ctx.instrument;
    if (mode === "ticks" && (inst?.tick_size ?? 0) > 0) {
      return `${fmtNum(v.base / inst!.tick_size!, 1)} ticks`;
    }
    if (mode === "pips") {
      const pip = pipSize(inst);
      if (pip != null) return `${fmtNum(v.base / pip, 1)} pips`;
    }
    return `${fmtNum(v.base, 2)} pts`;
  }

  // money
  switch (mode) {
    case "percentage": {
      const base = ctx.equityBase ?? 0;
      return base > 0 ? fmtPct((v.base / base) * 100, 2) : fmtMoney(v.base, currency);
    }
    case "r": {
      const risk = ctx.riskMoney ?? 0;
      return risk > 0 ? fmtR(v.base / risk) : fmtMoney(v.base, currency);
    }
    case "points":
    case "ticks":
    case "pips": {
      const pv = ctx.instrument?.point_value ?? 0;
      if (!(pv > 0)) return fmtMoney(v.base, currency);
      const points = v.base / pv;
      if (mode === "points") return `${fmtNum(points, 2)} pts`;
      if (mode === "ticks") {
        const tick = ctx.instrument?.tick_size ?? 0;
        return tick > 0
          ? `${fmtNum(points / tick, 1)} ticks`
          : fmtMoney(v.base, currency);
      }
      const pip = pipSize(ctx.instrument);
      return pip != null
        ? `${fmtNum(points / pip, 1)} pips`
        : fmtMoney(v.base, currency);
    }
    default:
      return fmtMoney(v.base, currency, { sign: false });
  }
}

/** Humanised duration: "3d 4h", "5h 20m", "45m". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || Number.isNaN(seconds) || seconds < 0) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;

  const totalMinutes = Math.floor(seconds / 60);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

/** Duration in whole days, for swing-oriented readouts. */
export function secondsToDays(seconds: number | null | undefined): number | null {
  if (seconds == null || Number.isNaN(seconds) || seconds < 0) return null;
  return seconds / 86_400;
}
