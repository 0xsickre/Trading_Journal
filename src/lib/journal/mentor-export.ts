// Builds a self-contained Markdown "mentor pack" from the user's trades.
// Upload the file into a Claude chat (or any LLM) to get trading-mentor
// feedback without any API integration — the numbers are pre-computed here
// so the model interprets, it never has to calculate (or hallucinate) stats.

import { toRealized, computeStats, breakdownByField, computeSlippageStats } from "./analytics";
import { getAllFormFields } from "./form-config";
import {
  fmtSlippagePts,
  fmtSlippageR,
  slippageFromTrade,
} from "./entry-slippage";
import type { TradeRow } from "./types";

const BREAKDOWNS: { field: string; label: string }[] = [
  { field: "setup_grade", label: "Setup Grade" },
  { field: "ict_entry_model", label: "Entry Model" },
  { field: "instrument", label: "Instrument" },
  { field: "direction", label: "Direction" },
  { field: "technical_tags", label: "Technical Tags" },
  { field: "psychology_tags", label: "Psychology Tags" },
  { field: "discipline", label: "Discipline" },
  { field: "mistake", label: "Mistake" },
  { field: "htf_bias", label: "HTF Bias" },
];

// Every user-entered field, in form order, plus the auto-computed ones and the
// planned price levels — so the export contains EVERYTHING typed on a trade.
// instrument/direction are shown in the header, so they're skipped in the body.
const HEADER_KEYS = new Set(["instrument", "direction"]);
const DETAIL_FIELDS: { key: string; label: string }[] = (() => {
  const seen = new Set<string>();
  const out: { key: string; label: string }[] = [];
  const add = (key: string, label: string) => {
    if (seen.has(key) || HEADER_KEYS.has(key)) return;
    seen.add(key);
    out.push({ key, label });
  };
  for (const f of getAllFormFields()) add(f.name, f.label);
  // Derived / computed columns that also carry user-meaningful info.
  add("planned_rr", "Planned RR");
  add("position_size", "Position size");
  add("chart_url", "Chart URL");
  add("result", "Result");
  return out;
})();

function val(row: TradeRow, key: string): string {
  const v = row[key];
  if (v == null || v === "") return "";
  if (Array.isArray(v)) return v.filter(Boolean).join(", ");
  return String(v);
}

const r2 = (n: number | null | undefined) => (n == null ? "—" : n.toFixed(2));
const pct = (n: number) => `${n.toFixed(1)}%`;
const money = (n: number, ccy: string) =>
  `${n >= 0 ? "+" : "-"}${Math.abs(n).toFixed(2)} ${ccy}`;

function statsTable(trades: TradeRow[], ccy: string): string {
  const s = computeStats(toRealized(trades), "net");
  const slip = computeSlippageStats(toRealized(trades));
  const slipAvg =
    slip.count > 0 ? `${(-slip.avgAdverseR).toFixed(2)}R` : "—";
  const slipTotal =
    slip.count > 0 ? `${(-slip.totalAdverseR).toFixed(2)}R` : "—";
  return [
    `| Metric | Value |`,
    `| --- | --- |`,
    `| Closed trades | ${s.count} |`,
    `| Win rate | ${pct(s.winRate)} (${s.wins}W / ${s.losses}L / ${s.breakeven}BE) |`,
    `| Net P/L | ${money(s.netSum, ccy)} |`,
    `| Total R | ${r2(s.totalR)}R |`,
    `| Avg R / trade | ${r2(s.avgR)}R |`,
    `| Expectancy | ${r2(s.expectancy)}R |`,
    `| Profit factor | ${s.profitFactor == null ? "∞" : s.profitFactor.toFixed(2)} |`,
    `| Avg win / Avg loss | ${r2(s.avgWin)}R / ${r2(s.avgLoss)}R |`,
    `| Best / Worst | ${money(s.best, ccy)} / ${money(s.worst, ccy)} |`,
    `| Max win / loss streak | ${s.maxWinStreak} / ${s.maxLossStreak} |`,
    `| Max drawdown | ${money(s.maxDrawdown, ccy)} |`,
    `| Avg entry slippage | ${slipAvg} (${slip.count} trades) |`,
    `| Total slippage (R) | ${slipTotal} |`,
  ].join("\n");
}

function breakdownTable(trades: TradeRow[], field: string): string {
  const rows = breakdownByField(toRealized(trades), field).filter(
    (r) => r.key !== "—" && r.count > 0,
  );
  if (rows.length === 0) return "_no data_";
  const head = `| Value | Trades | Win % | Avg R | Total R | Net |\n| --- | --- | --- | --- | --- | --- |`;
  const body = rows
    .map(
      (r) =>
        `| ${r.key} | ${r.count} | ${pct(r.winRate)} | ${r2(r.avgR)}R | ${r2(r.totalR)}R | ${r.netSum.toFixed(2)} |`,
    )
    .join("\n");
  return `${head}\n${body}`;
}

function tradeDetail(t: TradeRow, ccy: string): string {
  const s = t.stats;
  const when = s?.closed_at ? s.closed_at.slice(0, 16).replace("T", " ") : "open";
  const no = t.trade_no != null ? `#${t.trade_no}` : t.id.slice(0, 8);
  const rr = s?.realized_r != null ? `${r2(s.realized_r)}R` : "—";
  const net = s?.net_pl != null ? money(s.net_pl, ccy) : "—";
  const head = `### Trade ${no} — ${val(t, "instrument") || "?"} ${val(t, "direction")} · ${when} · ${rr} · ${net} · ${t.status}`;
  const lines = DETAIL_FIELDS.map((f) => {
    const v = val(t, f.key);
    return v ? `- **${f.label}:** ${v}` : "";
  }).filter(Boolean);
  const slip = slippageFromTrade(t);
  if (slip) {
    const rPart =
      slip.slippageR != null ? fmtSlippageR(slip.slippageR) : "—";
    lines.push(
      `- **Entry slippage:** ${rPart} (${fmtSlippagePts(slip.adversePts)} adverse)`,
    );
  }
  return `${head}\n${lines.join("\n")}`;
}

export type Granularity =
  | "day"
  | "week"
  | "month"
  | "quarter"
  | "year"
  | "custom"
  | "all";

const pad2 = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) =>
  `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;

export type CalendarRange = {
  fromISO: string | null; // inclusive start, or null for "all"
  toISO: string | null; // inclusive end, or null for "all"
  label: string;
  rangeText: string;
};

/**
 * Resolve an exact calendar period (in UTC — matching the app's Monday-based
 * week_start convention) from a granularity + an anchor date. The period is the
 * calendar unit that CONTAINS the anchor (e.g. week → the Mon–Sun around it).
 */
export function resolveCalendarRange(
  granularity: Granularity,
  anchor: string, // "YYYY-MM-DD"
  from?: string,
  to?: string,
): CalendarRange {
  if (granularity === "all")
    return { fromISO: null, toISO: null, label: "All", rangeText: "sve vreme" };

  if (granularity === "custom") {
    const f = from || anchor;
    const t = to || from || anchor;
    const [lo, hi] = f <= t ? [f, t] : [t, f];
    return {
      fromISO: `${lo}T00:00:00.000Z`,
      toISO: `${hi}T23:59:59.999Z`,
      label: "Custom",
      rangeText: `${lo} → ${hi}`,
    };
  }

  const base = new Date(`${anchor}T00:00:00.000Z`);
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth();
  const d = base.getUTCDate();
  let start: Date;
  let end: Date;
  let label: string;

  if (granularity === "day") {
    start = new Date(Date.UTC(y, m, d));
    end = start;
    label = "Day";
  } else if (granularity === "week") {
    const dow = base.getUTCDay(); // 0=Sun … 6=Sat
    const toMonday = dow === 0 ? -6 : 1 - dow;
    start = new Date(Date.UTC(y, m, d + toMonday));
    end = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + 6),
    );
    label = "Week";
  } else if (granularity === "month") {
    start = new Date(Date.UTC(y, m, 1));
    end = new Date(Date.UTC(y, m + 1, 0));
    label = "Month";
  } else if (granularity === "quarter") {
    const q = Math.floor(m / 3);
    start = new Date(Date.UTC(y, q * 3, 1));
    end = new Date(Date.UTC(y, q * 3 + 3, 0));
    label = "Quarter";
  } else {
    // year
    start = new Date(Date.UTC(y, 0, 1));
    end = new Date(Date.UTC(y, 11, 31));
    label = "Year";
  }

  const f = ymd(start);
  const t = ymd(end);
  return {
    fromISO: `${f}T00:00:00.000Z`,
    toISO: `${t}T23:59:59.999Z`,
    label,
    rangeText: `${f} → ${t}`,
  };
}

export type MentorPackOpts = {
  currency?: string;
  /** Safety cap on trades expanded in full detail (period already bounds it). */
  detailCap?: number;
  /** Label describing the account scope, e.g. account name or "All accounts". */
  scopeLabel?: string;
  /** Human label for the selected period, e.g. "Week", "Month", "All". */
  periodLabel?: string;
  /** Resolved date range for the period, e.g. "2026-07-01 → 2026-07-08". */
  rangeText?: string;
};

export function buildMentorPack(
  trades: TradeRow[],
  opts: MentorPackOpts = {},
): string {
  const ccy = opts.currency ?? "USD";
  const detailCap = opts.detailCap ?? 300;
  const scope = opts.scopeLabel ?? "All accounts";
  const period = opts.periodLabel ?? "All";
  const range = opts.rangeText ?? "sve vreme";

  const realized = toRealized(trades);
  const sortedClosed = [...realized]
    .sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? ""))
    .map((r) => r.row);
  const detail = sortedClosed.slice(0, detailCap);
  const truncated = sortedClosed.length - detail.length;

  const openReview = trades.filter(
    (t) => t.status !== "closed" || t.needs_review,
  );

  const out: string[] = [];

  out.push(`# Trading Journal — Mentor Pack`);
  out.push(
    `_Generisano: ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC · Period: ${period} (${range}) · Scope: ${scope} · Valuta: ${ccy}_`,
  );
  out.push("");

  // --- Instructions / persona for the model -------------------------------
  out.push(`## Uputstvo za tebe (AI mentor)`);
  out.push(
    [
      "Ti si moj lični **ICT trading mentor**. Ovaj fajl je izvoz iz mog trading žurnala.",
      "Svi brojevi su već izračunati — **ne preračunavaj** ih; koristi ih onakve kakvi jesu.",
      "",
      "Tvoj zadatak:",
      "- Nađi **obrasce** u mojim rezultatima (koji setapi/tagovi/psihologija donose profit, a koji gube).",
      "- Budi **kritičan i direktan** — istakni crvene zastavice, nemoj mi laskati.",
      "- Fokus na **proces i disciplinu**, ne na predviđanje tržišta.",
      "- Coaching stil: postavljaj mi pitanja, daj 2–3 konkretna zadatka za sledeću nedelju.",
      "",
      "Šta NE radiš: ne daješ buy/sell signale, ne predviđaš cenu, ne daješ finansijski/regulatorni savet.",
      "Odgovaraj na srpskom.",
    ].join("\n"),
  );
  out.push("");

  // --- Overall stats ------------------------------------------------------
  out.push(`## Ukupna statistika`);
  out.push(statsTable(trades, ccy));
  out.push("");

  // --- Breakdowns ---------------------------------------------------------
  out.push(`## Performanse po kategorijama`);
  for (const b of BREAKDOWNS) {
    out.push(`### ${b.label}`);
    out.push(breakdownTable(trades, b.field));
    out.push("");
  }

  // --- Open / needs-review ------------------------------------------------
  if (openReview.length > 0) {
    out.push(`## Otvorene / za pregled (${openReview.length})`);
    for (const t of openReview.slice(0, 20)) out.push(tradeDetail(t, ccy));
    out.push("");
  }

  // --- Full trade detail (everything entered) -----------------------------
  out.push(`## Zatvoreni trejdovi — puni detalji (${detail.length})`);
  out.push(
    `_Svako polje koje si uneo je ispod. Prazna polja su izostavljena._`,
  );
  out.push("");
  for (const t of detail) out.push(tradeDetail(t, ccy));
  if (truncated > 0)
    out.push(`\n_(+${truncated} starijih trejdova nije prošireno — suzi period za pun detalj.)_`);
  out.push("");

  return out.join("\n");
}
