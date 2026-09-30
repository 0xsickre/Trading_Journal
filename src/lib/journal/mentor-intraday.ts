/**
 * The day trader's half of the mentor pack (F5.6).
 *
 * The pack was written for a swing book: totals, tag tables and every field of
 * every trade. A model reading it about an intraday Topstep book could not see
 * what decides that book — how close the account is to its floor and its daily
 * limit, when in the session the trader acts, what happens after two losses,
 * which of the trader's own rules held on which day, and whether an entry sat
 * inside a news window. Each section here answers one of those, from values the
 * journal already derives; nothing is computed that the screens do not show.
 *
 * Every table states its sample, and a group under `SMALL_SAMPLE` trades is
 * marked in the table itself: the model is told to read the mark, and a mark
 * travels with the number where a paragraph of caveats would be skipped.
 */

import { computeStats, type RealizedTrade } from "./analytics";
import type { BreakevenRange } from "./breakeven";
import type { DailyReportLite, EnrichedTrade } from "./enriched-trade";
import { loggedAfterEntry } from "./plan-snapshot";
import { getDimension, type DimensionContext } from "./reports/dimensions";
import type { RedWindow, SessionBrief } from "./session-brief";
import { minutesAfterOpen, SESSION_TZ } from "./session-window";
import { fmtInTz, toEpoch } from "./time";
import { TOPSTEP_CONSISTENCY, type TopstepResult } from "./topstep";
import type { DayCompliance } from "./tracker/compliance";
import { WEEKDAY_LABELS, type TrackerRule } from "./tracker-types";
import { formatDuration } from "./units";

/** Groups with fewer trades than this carry a mark in every table. */
export const SMALL_SAMPLE = 10;

/** Trading days the daily table lists before it says how many it left out. */
const DAY_ROWS_CAP = 60;

const r2 = (n: number | null | undefined) => (n == null ? "—" : n.toFixed(2));
const signed = (n: number, ccy: string) => `${n >= 0 ? "+" : "-"}${Math.abs(n).toFixed(2)} ${ccy}`;
const cell = (s: string) => s.replace(/\|/g, "\\|");

/** Serbian plural: 1 gubitak, 2 gubitka, 5 gubitaka — and 11–14 take the last form. */
export function sr(n: number, one: string, few: string, many: string): string {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return one;
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return few;
  return many;
}

/** The intraday dimensions, in the order a mentor reads a day. */
const INTRADAY_DIMENSIONS: { key: string; label: string }[] = [
  { key: "session_window", label: "Sesijski prozor (ET)" },
  { key: "minutes_from_open", label: "Koliko posle otvaranja 09:30 ET" },
  { key: "trade_no_in_day", label: "Redni broj trejda u danu (po nalogu)" },
  { key: "after_loss", label: "Stanje pre ulaza (gubici zaredom tog dana)" },
  { key: "hold_duration", label: "Trajanje trejda" },
  { key: "entry_hour", label: "Sat ulaza (zona naloga)" },
  { key: "dow_entry", label: "Dan u nedelji" },
];

/** One dimension as a table of results per bucket, in the dimension's own order. */
export function dimensionTable(
  trades: readonly EnrichedTrade[],
  key: string,
  range: BreakevenRange,
): string {
  const dim = getDimension(key);
  if (!dim) return "_nema podataka_";
  const ctx: DimensionContext = { reportByDate: new Map() };
  const buckets = new Map<string, RealizedTrade[]>();
  for (const t of trades) {
    const v = dim.valueOf(t, ctx);
    for (const b of v == null ? [] : Array.isArray(v) ? v : [v]) {
      buckets.set(b, [...(buckets.get(b) ?? []), t.trade]);
    }
  }
  if (buckets.size === 0) return "_nema podataka_";
  const order = dim.order ?? [];
  const keys = [
    ...order.filter((k) => buckets.has(k)),
    ...[...buckets.keys()].filter((k) => !order.includes(k)).sort(),
  ];
  const head = `| Grupa | Trejdova | Win % | Avg R | Total R | Net |\n| --- | --- | --- | --- | --- | --- |`;
  const body = keys.map((k) => {
    const s = computeStats(buckets.get(k)!, "net", range);
    const n = s.count < SMALL_SAMPLE ? `${s.count} ⚠` : String(s.count);
    const win = s.wins + s.losses > 0 ? `${s.winRate.toFixed(1)}%` : "—";
    return `| ${cell(k)} | ${n} | ${win} | ${r2(s.avgR)}R | ${r2(s.totalR)}R | ${s.netSum.toFixed(2)} |`;
  });
  return `${head}\n${body.join("\n")}`;
}

export function intradaySection(trades: readonly EnrichedTrade[], range: BreakevenRange): string[] {
  const out = [
    `## Kada i kako trgujem (intraday obrasci)`,
    `_⚠ = manje od ${SMALL_SAMPLE} trejdova u grupi: to je hipoteza za proveru, ne zaključak._`,
    "",
  ];
  for (const d of INTRADAY_DIMENSIONS) {
    out.push(`### ${d.label}`, dimensionTable(trades, d.key, range), "");
  }
  return out;
}

/** Trading-day figures a mentor asks for before any table: how the days go, not only the trades. */
export function dayShapeRows(trades: readonly EnrichedTrade[], ccy: string): string[] {
  const days = new Map<string, EnrichedTrade[]>();
  for (const t of trades) if (t.closeDay) days.set(t.closeDay, [...(days.get(t.closeDay) ?? []), t]);
  if (days.size === 0) return [];
  const nets = [...days.values()].map((d) => d.reduce((s, t) => s + t.pnl, 0));
  const green = nets.filter((n) => n > 0);
  const red = nets.filter((n) => n < 0);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const counts = [...days.values()].map((d) => d.length);
  const held = trades.map((t) => t.durationSeconds).filter((s): s is number => s != null).sort((a, b) => a - b);
  const sizes = trades.map((t) => t.size).filter((s): s is number => s != null && s > 0);
  const avgGreen = mean(green);
  const avgRed = mean(red);
  return [
    `| Trading dana | ${days.size} (zeleno ${green.length}, crveno ${red.length}) |`,
    `| Trejdova po danu | prosek ${(trades.length / days.size).toFixed(1)}, najviše ${Math.max(...counts)} |`,
    `| Prosečan zeleni / crveni dan | ${avgGreen == null ? "—" : signed(avgGreen, ccy)} / ${avgRed == null ? "—" : signed(avgRed, ccy)} |`,
    `| Medijana trajanja trejda | ${held.length ? formatDuration(held[Math.floor(held.length / 2)]) : "—"} |`,
    `| Prosečna veličina | ${sizes.length ? `${mean(sizes)!.toFixed(1)} ugovora` : "—"} |`,
  ];
}

/** The longest run of losses in a list, in close order. */
function longestLossRun(trades: readonly EnrichedTrade[]): number {
  let best = 0;
  let run = 0;
  for (const t of [...trades].sort((a, b) => (a.closedAt ?? "").localeCompare(b.closedAt ?? ""))) {
    run = t.outcome === "loss" ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

export type DailyContext = {
  ccy: string;
  range: BreakevenRange;
  compliance?: ReadonlyMap<string, DayCompliance>;
  ruleText?: ReadonlyMap<string, string>;
  /** Trading days whose loss reached a Topstep account's DLL. */
  dllDays?: ReadonlySet<string>;
  reportByDate?: ReadonlyMap<string, DailyReportLite>;
  /** The futures-trading brief per trading day: its note and news windows. */
  briefByDay?: ReadonlyMap<string, SessionBrief>;
};

/** One row per trading day, oldest first — the day is the unit a day trader is judged on. */
export function dailySection(trades: readonly EnrichedTrade[], ctx: DailyContext): string[] {
  const days = new Map<string, EnrichedTrade[]>();
  for (const t of trades) if (t.closeDay) days.set(t.closeDay, [...(days.get(t.closeDay) ?? []), t]);
  if (days.size === 0) return [];
  const keys = [...days.keys()].sort();
  const shown = keys.slice(-DAY_ROWS_CAP);
  const out = [
    `## Dnevni pregled (${days.size} trading dana)`,
    `_Dan = trading dan naloga (Topstep: 17:00–17:00 CT). Pravila = % tvojih pravila iz dnevnog trackera koja su ispoštovana; u zagradi propuštena._`,
    "",
    `| Dan | Trejdova | W/L/BE | Net | R | Prvi ulaz (ET) | Najduži niz gubitaka | Max ugovora | Pravila | Napomena |`,
    `| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |`,
  ];
  for (const day of shown) {
    const list = days.get(day)!;
    const realized = list.map((t) => t.trade);
    const s = computeStats(realized, "net", ctx.range);
    const first = list
      .map((t) => t.openedAt)
      .filter((o): o is string => o != null)
      .sort()[0];
    const sizes = list.map((t) => t.size).filter((v): v is number => v != null);
    const c = ctx.compliance?.get(day);
    const missed = (c?.missedRuleIds ?? []).map((id) => ctx.ruleText?.get(id) ?? id);
    const rules =
      c?.pct == null ? "—" : `${Math.round(c.pct)}%${missed.length ? ` (${missed.join("; ")})` : ""}`;
    const notes: string[] = [];
    if (ctx.dllDays?.has(day)) notes.push("DLL dostignut");
    const inRed = list.filter((t) => redWindowAt(t.openedAt, ctx.briefByDay?.get(t.openDay)) != null).length;
    if (inRed > 0) notes.push(`${inRed} ${sr(inRed, "ulaz", "ulaza", "ulaza")} u crvenom prozoru`);
    const dayNote = ctx.briefByDay?.get(day)?.dayNote;
    if (dayNote) notes.push(dayNote);
    const rep = ctx.reportByDate?.get(day);
    if (rep?.mental_temp != null) notes.push(`mentalno ${rep.mental_temp}/5`);
    out.push(
      `| ${day} | ${list.length} | ${s.wins}/${s.losses}/${s.breakeven} | ${s.netSum.toFixed(2)} | ${r2(s.totalR)}R | ${
        first ? fmtInTz(first, SESSION_TZ, "HH:mm") : "—"
      } | ${longestLossRun(list)} | ${sizes.length ? Math.max(...sizes) : "—"} | ${cell(rules)} | ${cell(
        notes.join(", ") || "—",
      )} |`,
    );
  }
  if (keys.length > shown.length) {
    out.push("", `_(+${keys.length - shown.length} starijih dana nije prikazano — suzi period.)_`);
  }
  out.push("");
  return out;
}

/** A Topstep account as the mentor needs it: how far from the end, and by which rule. */
export type MentorTopstep = {
  accountName: string;
  plan: string;
  startingBalance: number;
  /** The trader's risk rule: this share of the room above the MLL per trade. */
  riskRulePct: number | null;
  result: TopstepResult;
};

export function topstepSection(accounts: readonly MentorTopstep[], ccy: string): string[] {
  if (accounts.length === 0) return [];
  const out = [
    `## Topstep nalog — stanje i pravila firme`,
    `_Stanje danas, ne samo za izabrani period: ovo odlučuje da li nalog preživljava._`,
    "",
  ];
  for (const a of accounts) {
    const r = a.result;
    const m = (n: number) => `${n.toFixed(2)} ${ccy}`;
    const consistencyCap = r.rules.target * TOPSTEP_CONSISTENCY;
    out.push(
      `### ${cell(a.accountName)} — ${a.plan} · status: ${r.status}`,
      `| Stavka | Vrednost |`,
      `| --- | --- |`,
      `| Balans / početni | ${m(r.balance)} / ${m(a.startingBalance)} (profit ${signed(r.profit, ccy)}${r.paidOut > 0 ? `, isplaćeno ${m(r.paidOut)}` : ""}) |`,
      `| MLL (trailing) | pod ${m(r.mllFloor)}${r.mllLocked ? " — zaključan na početnom balansu" : ""}; prostor do njega ${m(r.room)} od ${m(r.rules.mll)} |`,
      `| Najbliže MLL-u ikad | ${r.headroomPct == null ? "—" : `${r.headroomPct.toFixed(0)}% prostora je ostalo u najgorem trenutku`} |`,
      `| DLL | ${m(r.rules.dll)} dnevno${r.personalDll ? " (lični limit, uži od plana)" : ""}; danas ${signed(r.todayNet, ccy)}, ostalo ${m(r.dllLeftToday)} |`,
      `| Dnevni cilj profita | ${r.dailyTarget == null ? "nije postavljen" : `${m(r.dailyTarget)}; do njega danas ${m(r.targetLeftToday ?? 0)}`} |`,
      `| Dani kad je DLL dostignut | ${r.dllDays.length ? `${r.dllDays.length}: ${r.dllDays.join(", ")}` : "nijedan"} |`,
      `| Cilj | ${m(r.effectiveTarget)}${r.effectiveTarget > r.rules.target ? ` (porastao sa ${m(r.rules.target)} zbog pravila konzistentnosti)` : ""}; do cilja ${m(Math.max(0, r.effectiveTarget - r.profit))} |`,
      `| Najbolji dan / granica konzistentnosti | ${r.bestDay ? `${signed(r.bestDay.net, ccy)} (${r.bestDay.day})` : "—"} / ${m(consistencyCap)} (${Math.round(TOPSTEP_CONSISTENCY * 100)}% cilja) — ${r.consistencyOk ? "u redu" : "PREKORAČENO"} |`,
      `| Trading dana | ${r.daysTraded} |`,
      `| Max pozicija | ${r.rules.maxMini} mini / ${r.rules.maxMini * 10} mikro ugovora |`,
      `| Pravilo rizika po trejdu | ${a.riskRulePct == null ? "—" : `${a.riskRulePct}% prostora do MLL-a`}, u granicama ${m(r.rules.riskMin)}–${m(r.rules.riskMax)} |`,
      "",
    );
  }
  return out;
}

const STAGE_LABEL: Record<TrackerRule["stage"], string> = {
  prepare: "priprema",
  trade: "trgovanje",
  reflect: "osvrt",
};

function ruleLine(rule: TrackerRule): string {
  const auto = rule.auto_key
    ? ` · automatski: \`${rule.auto_key}\``
    : " · ručno štikliram";
  const days =
    rule.active_days.length === 7 ? "svaki dan" : rule.active_days.map((d) => WEEKDAY_LABELS[d] ?? d).join(", ");
  return `- ${cell(rule.text)} (${STAGE_LABEL[rule.stage]}${rule.is_mandatory ? ", obavezno" : ""}${auto} · ${days})`;
}

/**
 * A rule as a daily-table cell: the name before the colon, or the first words.
 * The full sentences are listed once under "Moja pravila"; repeated in every
 * day's row they made the table unreadable. A rule deleted since still counts
 * on the days it was live, and says so, because the list above no longer has it.
 */
export function ruleLabel(rule: Pick<TrackerRule, "text" | "deleted_at">): string {
  const text = rule.text.trim();
  const colon = text.indexOf(":");
  const name =
    colon > 0 && colon <= 48 ? text.slice(0, colon) : text.length <= 48 ? text : `${text.slice(0, 45).trimEnd()}…`;
  return rule.deleted_at == null ? name : `${name} (ukinuto)`;
}

/** The trader's own rules, and how often each was broken in the period. */
export function rulesSection(rules: readonly TrackerRule[], compliance: readonly DayCompliance[]): string[] {
  const live = rules.filter((r) => r.deleted_at == null);
  if (live.length === 0) return [];
  const out = [`## Moja pravila (dnevni tracker)`, ...live.map(ruleLine), ""];
  const judged = compliance.filter((c) => c.pct != null);
  if (judged.length > 0) {
    const avg = judged.reduce((s, c) => s + (c.pct as number), 0) / judged.length;
    const perfect = judged.filter((c) => c.pct === 100).length;
    const misses = new Map<string, number>();
    for (const c of judged) for (const id of c.missedRuleIds) misses.set(id, (misses.get(id) ?? 0) + 1);
    const text = new Map(rules.map((r) => [r.id, r.text]));
    out.push(
      `Usklađenost u periodu: prosek **${avg.toFixed(0)}%** na ${judged.length} ${sr(judged.length, "dan", "dana", "dana")}; ${perfect} ${sr(perfect, "dan", "dana", "dana")} bez ijednog prekršaja.`,
    );
    const top = [...misses.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (top.length) {
      out.push("Najčešće prekršeno:");
      for (const [id, n] of top) out.push(`- ${cell(text.get(id) ?? id)} — ${n} ${sr(n, "dan", "dana", "dana")}`);
    }
    out.push("");
  }
  return out;
}

/** The news window an entry fell in, from that trading day's brief. */
function redWindowAt(openedAt: string | null, brief: SessionBrief | undefined): RedWindow | null {
  if (!openedAt || !brief) return null;
  const t = toEpoch(openedAt);
  return brief.redWindows.find((w) => toEpoch(w.from) <= t && t <= toEpoch(w.to)) ?? null;
}

/** The intraday facts of one trade, as lines under its heading in the full detail. */
export function tradeContextLines(
  e: EnrichedTrade,
  opts: {
    displayTz: string;
    brief?: SessionBrief;
    insightTitles?: readonly string[];
    accountName?: string;
  },
): string[] {
  const lines: string[] = [];
  if (e.openedAt) {
    const after = minutesAfterOpen(e.openedAt);
    const parts = [
      `ulaz ${fmtInTz(e.openedAt, opts.displayTz, "dd.MM. HH:mm:ss")}`,
      e.closedAt ? `izlaz ${fmtInTz(e.closedAt, opts.displayTz, "HH:mm:ss")}` : null,
      `(${opts.displayTz}) = ${fmtInTz(e.openedAt, SESSION_TZ, "HH:mm")} ET`,
      e.sessionWindow,
      after != null ? `${after} min posle otvaranja` : null,
    ].filter((p): p is string => p != null);
    lines.push(`- **Vreme:** ${parts.join(" · ")}`);
  }
  const day = [
    opts.accountName ? `nalog ${opts.accountName}` : null,
    e.tradeNoInDay != null ? `${e.tradeNoInDay}. trejd dana` : null,
    e.lossStreakBefore != null && e.tradeNoInDay != null && e.tradeNoInDay > 1
      ? `pre ulaza ${e.lossStreakBefore} ${sr(e.lossStreakBefore, "gubitak", "gubitka", "gubitaka")} zaredom`
      : null,
    // Which entry the R, risk and slippage are measured from: a plan sealed
    // before the fill keeps its price; one typed in after a market order uses
    // the fill, and its "Planned Entry Price" below is not a reference.
    loggedAfterEntry(e.trade.row) ? "upisan posle ulaza (market) — R od fill-a" : "plan pre ulaza",
    e.durationSeconds != null ? `trajanje ${formatDuration(e.durationSeconds)}` : null,
    e.size != null ? `${e.size} ${sr(e.size, "ugovor", "ugovora", "ugovora")}` : null,
    e.riskMoney != null ? `rizik do stopa ${e.riskMoney.toFixed(2)}` : null,
    e.underwaterPct != null ? `${e.underwaterPct}% vremena u minusu` : null,
  ].filter((p): p is string => p != null);
  if (day.length) lines.push(`- **Kontekst:** ${day.join(" · ")}`);
  const w = redWindowAt(e.openedAt, opts.brief);
  if (w) {
    lines.push(
      `- **Ulaz u crvenom prozoru:** ${cell(w.title)}${w.impact ? ` (${w.impact})` : ""} ${fmtInTz(w.from, SESSION_TZ, "HH:mm")}–${fmtInTz(w.to, SESSION_TZ, "HH:mm")} ET`,
    );
  }
  if (opts.insightTitles?.length) lines.push(`- **Zapažanja na ovom trejdu:** ${opts.insightTitles.join("; ")}`);
  return lines;
}
