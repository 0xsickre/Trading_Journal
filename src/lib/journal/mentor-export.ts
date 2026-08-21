// Builds a self-contained Markdown "mentor pack" from the user's trades.
// Upload the file into a Claude chat (or any LLM) to get trading-mentor
// feedback without any API integration — the numbers are pre-computed here
// so the model interprets, it never has to calculate (or hallucinate) stats.

import {
  toRealized,
  computeStats,
  breakdownByField,
  computeSlippageStats,
  computeExitEfficiencyStats,
  type RealizedTrade,
} from "./analytics";
import { EXACT_ZERO_RANGE, type BreakevenRange } from "./breakeven";
import type { FieldDef } from "./field-def-types";
import { displayFieldValue } from "./field-values";
import { getAllFormFields } from "./form-config";
import {
  fmtSlippagePts,
  fmtSlippageR,
  slippageFromTrade,
} from "./entry-slippage";
import {
  exitEfficiencyFromTrade,
  fmtExitEfficiencyPct,
} from "./exit-efficiency";
import { compareInstants } from "./time";
import type { TradeRow } from "./types";
import { groupInsights } from "./insights/types";
import { OMITTED_RULES, type RunResult } from "./insights/registry";
import { computeExcursionStats, excursionFromTrade } from "./excursion";
import type { RuleLookup } from "./reports/rule-lookup";

// Fixed breakdowns. The user-defined fields are appended by `breakdownsFor`,
// so a field added in Settings shows up in the mentor pack without an edit here.
const FIXED_BREAKDOWNS: { field: string; label: string }[] = [
  { field: "setup_grade", label: "Setup Grade" },
  { field: "instrument", label: "Instrument" },
  { field: "direction", label: "Direction" },
  { field: "technical_tags", label: "Technical Tags" },
  { field: "psychology_tags", label: "Psychology Tags" },
  { field: "mistake", label: "Mistake" },
];

function breakdownsFor(defs: readonly FieldDef[]) {
  return [
    ...FIXED_BREAKDOWNS,
    // Free-text fields make useless breakdown tables — one row per trade.
    ...defs
      .filter((d) => d.field_type === "select" || d.field_type === "tags")
      .map((d) => ({ field: d.key, label: d.label })),
  ];
}

// Every user-entered field, in form order, plus the auto-computed ones and the
// planned price levels — so the export contains EVERYTHING typed on a trade.
// instrument/direction are shown in the header, so they're skipped in the body.
const HEADER_KEYS = new Set(["instrument", "direction"]);

function detailFieldsFor(defs: readonly FieldDef[]) {
  const seen = new Set<string>();
  const out: { key: string; label: string }[] = [];
  const add = (key: string, label: string) => {
    if (seen.has(key) || HEADER_KEYS.has(key)) return;
    seen.add(key);
    out.push({ key, label });
  };
  for (const f of getAllFormFields(defs)) add(f.name, f.label);
  // Derived / computed columns that also carry user-meaningful info.
  add("planned_rr", "Planned RR");
  add("position_size", "Position size");
  add("miss_reason", "Miss reason");
  add("missed_at", "Missed at");
  add("tv_htf_pre", "TV HTF Pre");
  add("tv_ltf_pre", "TV LTF Pre");
  add("tv_ltf_post", "TV LTF Post");
  return out;
}

const val = (row: TradeRow, key: string): string =>
  displayFieldValue(row, key);

const r2 = (n: number | null | undefined) => (n == null ? "—" : n.toFixed(2));
const pct = (n: number) => `${n.toFixed(1)}%`;
const money = (n: number, ccy: string) =>
  `${n >= 0 ? "+" : "-"}${Math.abs(n).toFixed(2)} ${ccy}`;

function statsTable(
  realized: RealizedTrade[],
  ccy: string,
  range: BreakevenRange,
): string {
  const s = computeStats(realized, "net", range);
  const slip = computeSlippageStats(realized);
  const slipAvg =
    slip.count > 0 ? `${(-slip.avgAdverseR).toFixed(2)}R` : "—";
  const slipTotal =
    slip.count > 0 ? `${(-slip.totalAdverseR).toFixed(2)}R` : "—";
  const exitEff = computeExitEfficiencyStats(realized);
  const exitEffAvg =
    exitEff.count > 0 ? fmtExitEfficiencyPct(exitEff.avgPct) : "—";
  const exitEffWinner =
    exitEff.winnerCount > 0
      ? fmtExitEfficiencyPct(exitEff.avgWinnerPct)
      : "—";
  const exc = computeExcursionStats(realized);
  const excMae = exc.maeCount > 0 ? `${r2(exc.avgMaeR)}R (${exc.maeCount} trades)` : "—";
  const excMfe = exc.mfeCount > 0 ? `${r2(exc.avgMfeR)}R (${exc.mfeCount} trades)` : "—";
  return [
    `| Metric | Value |`,
    `| --- | --- |`,
    `| Closed trades | ${s.count} |`,
    `| Win rate | ${pct(s.winRate)} (${s.wins}W / ${s.losses}L / ${s.breakeven}BE) |`,
    `| Net P/L | ${money(s.netSum, ccy)} |`,
    `| Total R | ${r2(s.totalR)}R |`,
    `| Avg R / trade | ${r2(s.avgR)}R |`,
    `| Expectancy | ${r2(s.expectancy)}R |`,
    `| Profit factor | ${
      s.profitFactor == null
        ? "—"
        : Number.isFinite(s.profitFactor)
          ? s.profitFactor.toFixed(2)
          : "∞"
    } |`,
    `| Avg win / Avg loss (R) | ${r2(s.avgWinR)}R / ${r2(s.avgLossR)}R |`,
    `| Avg win / Avg loss (${ccy}) | ${money(s.avgWinMoney, ccy)} / ${money(s.avgLossMoney, ccy)} |`,
    `| Expectancy sample | ${s.expectancySample} of ${s.count} trades carry an R |`,
    `| Best / Worst | ${money(s.best, ccy)} / ${money(s.worst, ccy)} |`,
    `| Max win / loss streak | ${s.maxWinStreak} / ${s.maxLossStreak} |`,
    `| Max drawdown | ${money(s.maxDrawdown, ccy)} |`,
    `| Avg entry slippage | ${slipAvg} (${slip.count} trades) |`,
    `| Total slippage (R) | ${slipTotal} |`,
    `| Target attainment | ${exitEffAvg} (${exitEff.count} closed trades) |`,
    `| Winner target attainment | ${exitEffWinner} (${exitEff.winnerCount} wins) |`,
    `| Avg MAE (R) | ${excMae} |`,
    `| Avg MFE (R) | ${excMfe} |`,
  ].join("\n");
}

function breakdownTable(
  realized: RealizedTrade[],
  field: string,
  range: BreakevenRange,
  rules?: RuleLookup,
): string {
  const rows = breakdownByField(realized, field, range, rules).filter(
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

function tradeDetail(
  t: TradeRow,
  ccy: string,
  detailFields: { key: string; label: string }[],
): string {
  const s = t.stats;
  const when = s?.closed_at ? s.closed_at.slice(0, 16).replace("T", " ") : "open";
  const no = t.trade_no != null ? `#${t.trade_no}` : t.id.slice(0, 8);
  const rr = s?.realized_r != null ? `${r2(s.realized_r)}R` : "—";
  const net = s?.net_pl != null ? money(s.net_pl, ccy) : "—";
  const head = `### Trade ${no} — ${val(t, "instrument") || "?"} ${val(t, "direction")} · ${when} · ${rr} · ${net} · ${t.status}`;
  const tv = t.tv_images ?? {};
  const enriched: TradeRow = {
    ...t,
    tv_htf_pre: tv.htf_pre ?? "",
    tv_ltf_pre: tv.ltf_pre ?? "",
    tv_ltf_post: tv.ltf_post ?? "",
  };
  const lines = detailFields.map((f) => {
    const v = val(enriched, f.key);
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
  const exitEff = exitEfficiencyFromTrade(t);
  if (exitEff) {
    lines.push(
      `- **Target attainment:** ${fmtExitEfficiencyPct(exitEff.pct)} (${r2(exitEff.realizedR)}R / ${r2(exitEff.plannedRewardR)}R planned target)`,
    );
  }
  // MAE Price / MFE Price above (from `detailFields`) are the raw prices typed
  // in from the chart — this is the same excursion converted to R, on the same
  // basis realized_r uses (actual fill vs. planned risk distance), so it's
  // actually comparable to every other R figure in this pack.
  const exc = excursionFromTrade(t);
  if (exc.maeR != null || exc.mfeR != null) {
    const parts: string[] = [];
    if (exc.maeR != null) parts.push(`MAE ${r2(exc.maeR)}R`);
    if (exc.mfeR != null) parts.push(`MFE ${r2(exc.mfeR)}R`);
    if (exc.capturePct != null) parts.push(`capture ${pct(exc.capturePct)}`);
    lines.push(`- **MAE/MFE (R):** ${parts.join(" · ")}`);
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
    return { fromISO: null, toISO: null, label: "All", rangeText: "all time" };

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
  /** Playbook rules and their answers, for the derived Setup Grade table. */
  rules?: RuleLookup;
  /** Safety cap on trades expanded in full detail (period already bounds it). */
  detailCap?: number;
  /** Label describing the account scope, e.g. account name or "All accounts". */
  scopeLabel?: string;
  /** Human label for the selected period, e.g. "Week", "Month", "All". */
  periodLabel?: string;
  /** Resolved date range for the period, e.g. "2026-07-01 → 2026-07-08". */
  rangeText?: string;
  /** Account starting balance, shown as risk context (single-account scope only). */
  startingBalance?: number | null;
  /**
   * The account's breakeven band, so the export classifies wins and losses the
   * same way the dashboard does. Without it the pack fell back to exact-zero
   * and reported a different win rate for the same trades — in the copy that
   * goes to a mentor.
   */
  breakevenRange?: BreakevenRange;
  /** Insights already evaluated for this scope — see lib/journal/insights. */
  insights?: RunResult | null;
  /** Free-form risk note, e.g. "Rizik po trejdu: 1%". */
  riskNote?: string;
  /**
   * User-defined fields. Without them the pack still builds, but every custom
   * field is silently absent — so callers that have them must pass them.
   */
  fieldDefs?: FieldDef[];
};

export function buildMentorPack(
  trades: TradeRow[],
  opts: MentorPackOpts = {},
): string {
  const ccy = opts.currency ?? "USD";
  const detailCap = opts.detailCap ?? 300;
  const scope = opts.scopeLabel ?? "All accounts";
  const period = opts.periodLabel ?? "All";
  const rangeText = opts.rangeText ?? "sve vreme";
  const range = opts.breakevenRange ?? EXACT_ZERO_RANGE;
  const defs = opts.fieldDefs ?? [];
  const rules = opts.rules;
  const detailFields = detailFieldsFor(defs);

  // Derived once. statsTable and each of the ten breakdown tables used to call
  // toRealized(trades) themselves — twelve passes over the same trade list to
  // produce one document.
  const realized = toRealized(trades);
  const sortedClosed = [...realized]
    .sort((a, b) => compareInstants(b.closedAt, a.closedAt))
    .map((r) => r.row);
  const detail = sortedClosed.slice(0, detailCap);
  const truncated = sortedClosed.length - detail.length;

  const openReview = trades.filter(
    (t) =>
      t.status === "open" ||
      t.status === "partial" ||
      (t.status === "closed" && t.needs_review),
  );
  const missedSetups = trades
    .filter((t) => t.status === "missed")
    .sort((a, b) =>
      compareInstants(
        String(b.missed_at ?? b.created_at),
        String(a.missed_at ?? a.created_at),
      ),
    );

  const out: string[] = [];

  out.push(`# Trading Journal — Mentor Pack`);
  out.push(
    `_Generisano: ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC · Period: ${period} (${rangeText}) · Scope: ${scope} · Valuta: ${ccy}_`,
  );
  const context: string[] = [];
  if (opts.startingBalance != null)
    context.push(`Početni balans: ${opts.startingBalance.toFixed(2)} ${ccy}`);
  if (opts.riskNote) context.push(opts.riskNote);
  if (range.from !== 0 || range.to !== 0)
    context.push(
      `Breakeven pojas: ${range.from.toFixed(2)} do ${range.to.toFixed(2)} ${ccy}`,
    );
  if (context.length > 0) out.push(`_${context.join(" · ")}_`);
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
      "- Uzmi u obzir veličinu uzorka — ne izvlači jake zaključke iz par trejdova.",
      "",
      "**Strukturiraj odgovor ovako:**",
      "1. **Kratak rezime** — stanje na 3–4 rečenice (edge, disciplina, glavni rizik).",
      "2. **Šta radim dobro** — konkretno, uz brojeve iz fajla.",
      "3. **Crvene zastavice** — najskuplje greške/obrasci, poređane po uticaju.",
      "4. **Obrasci po kategorijama** — setapi/tagovi/psihologija koji nose profit vs. gubitak.",
      "5. **2–3 konkretna zadatka** za sledeću nedelju (merljiva, procesna).",
      "",
      "Šta NE radiš: ne daješ buy/sell signale, ne predviđaš cenu, ne daješ finansijski/regulatorni savet.",
      "Odgovaraj na srpskom.",
    ].join("\n"),
  );
  out.push("");

  // --- Metric legend so the model reads the numbers correctly --------------
  out.push(`## Legenda metrika (kako da čitaš brojeve)`);
  out.push(
    [
      "- **R** — realizovani rezultat u jedinicama *planiranog rizika* (1R = rizik do stopa). +2R = duplo veći dobitak od rizika.",
      "- **Win rate** — % dobitnih trejdova, računat po **novcu** (net > 0 = dobitak), breakeven se ne broji u imenilac.",
      "- **Expectancy** — očekivani rezultat po trejdu, izražen u **R**. Pozitivno = statistički isplativ sistem.",
      "- **Profit factor** — bruto profit ÷ bruto gubitak. > 1 profitabilno; ∞ (beskonačno) = nema gubitaka u uzorku.",
      "- **Avg win / Avg loss** — prosečan dobitak/gubitak u **R**.",
      "- **Max drawdown** — najveći pad kapitala od vrha, u novcu (po izabranom net/gross modu).",
      "- **Entry slippage** — koliko je stvarni ulaz gori od planiranog, u **R** (negativno = trošak lošijeg ulaza).",
      "- **Target attainment (exit efficiency)** — realizovani R ÷ planirani reward R (koliko sam od plana ciljanog poteza zapravo uzeo).",
      "- **MAE / MFE (R)** — maksimalni nepovoljni / povoljni pomak tokom trejda, u R, na istoj osnovi kao realizovani R (stvarni ulaz naspram planiranog rizika). \"MAE Price\"/\"MFE Price\" ispod svakog trejda su SIROVE cene sa grafikona, ne R — MAE/MFE (R) red je prevod tih cena u R.",
      "- **Sve R vrednosti (Total R, Avg R, Expectancy, MAE/MFE, slippage, target attainment) su uvek bruto (gross)** — kretanje cene, bez provizija/swap-a — bez obzira na net/gross mod. Samo novčani redovi (Net P/L, Avg win/loss u valuti, Max drawdown) su net. Pozitivan expectancy u R zato NE znači da troškovi ne jedu edge — to pokazuje samo Net P/L red.",
      "- Sve vrednosti su u valuti/TZ naloga; **net** = posle provizija i swap-a, **gross** = samo kretanje cene.",
    ].join("\n"),
  );
  out.push("");

  // --- Overall stats ------------------------------------------------------
  out.push(`## Ukupna statistika`);
  out.push(statsTable(realized, ccy, range));
  out.push("");

  // --- Insights -----------------------------------------------------------
  // Named patterns beat raw numbers for an LLM reader: "green to red, 4 times"
  // is a hypothesis it can work with, where a table of R-multiples is not.
  if (opts.insights) {
    out.push(`## Automatska zapažanja`);
    const groups = groupInsights(opts.insights.insights);
    if (groups.length === 0) {
      out.push("_Nijedan obrazac nije okinuo u ovom periodu._");
    } else {
      out.push(`| Obrazac | Ozbiljnost | Puta | Primer |`);
      out.push(`| --- | --- | --- | --- |`);
      for (const g of groups) {
        const sample = g.insights[0];
        out.push(
          `| ${g.title} | ${g.severity} | ${g.count} | ${sample.detail.replace(/\|/g, "\\|")} |`,
        );
      }
    }
    if (opts.insights.skipped.length > 0) {
      out.push("");
      out.push(
        `_Nije procenjeno zbog malog uzorka: ${opts.insights.skipped
          .map((s) => `${s.id} (traži ${s.minSample}, ima ${s.sample})`)
          .join(", ")}._`,
      );
    }
    if (OMITTED_RULES.length > 0) {
      out.push("");
      out.push(
        `_Svesno neimplementirano (traži intraday cenovni feed): ${OMITTED_RULES.map(
          (o) => o.id,
        ).join(", ")}._`,
      );
    }
    out.push("");
  }

  // --- Breakdowns ---------------------------------------------------------
  out.push(`## Performanse po kategorijama`);
  for (const b of breakdownsFor(defs)) {
    out.push(`### ${b.label}`);
    out.push(breakdownTable(realized, b.field, range, rules));
    out.push("");
  }

  // --- Open / needs-review ------------------------------------------------
  if (openReview.length > 0) {
    out.push(`## Otvorene / za pregled (${openReview.length})`);
    for (const t of openReview.slice(0, 20))
      out.push(tradeDetail(t, ccy, detailFields));
    out.push("");
  }

  if (missedSetups.length > 0) {
    out.push(`## Missed setup-i (${missedSetups.length})`);
    out.push(`_Planirani trejdovi koji nikad nisu otvoreni — bez PnL._`);
    out.push("");
    for (const t of missedSetups.slice(0, 30))
      out.push(tradeDetail(t, ccy, detailFields));
    out.push("");
  }

  // --- Full trade detail (everything entered) -----------------------------
  out.push(`## Zatvoreni trejdovi — puni detalji (${detail.length})`);
  out.push(
    `_Svako polje koje si uneo je ispod. Prazna polja su izostavljena._`,
  );
  out.push("");
  for (const t of detail) out.push(tradeDetail(t, ccy, detailFields));
  if (truncated > 0)
    out.push(`\n_(+${truncated} starijih trejdova nije prošireno — suzi period za pun detalj.)_`);
  out.push("");

  return out.join("\n");
}
