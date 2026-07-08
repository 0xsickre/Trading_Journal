// Builds a self-contained Markdown "mentor pack" from the user's trades.
// Upload the file into a Claude chat (or any LLM) to get trading-mentor
// feedback without any API integration — the numbers are pre-computed here
// so the model interprets, it never has to calculate (or hallucinate) stats.

import { toRealized, computeStats, breakdownByField } from "./analytics";
import { getAllFormFields } from "./form-config";
import type { TradeRow } from "./types";

const BREAKDOWNS: { field: string; label: string }[] = [
  { field: "setup_grade", label: "Setup Grade" },
  { field: "ict_entry_model", label: "Entry Model" },
  { field: "instrument", label: "Instrument" },
  { field: "direction", label: "Direction" },
  { field: "confluences", label: "Confluences" },
  { field: "setup_tags", label: "Setup Tags" },
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
  return `${head}\n${lines.join("\n")}`;
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
