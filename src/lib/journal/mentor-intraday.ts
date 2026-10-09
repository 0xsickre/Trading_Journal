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
import { loggedAfterEntry, sealedNumber } from "./plan-snapshot";
import { getDimension, type DimensionContext } from "./reports/dimensions";
import { afterExitR, scenarioOf, scenarioTrade, summarizeScenarios } from "./scenario";
import type { RedWindow, SessionBrief } from "./session-brief";
import { minutesAfterOpen, SESSION_TZ } from "./session-window";
import { numberFieldValue } from "./field-values";
import { roomAtEntry } from "./risk-taken";
import { needsOriginalStop, stopStatus } from "./stop-moved";
import { fmtInTz, isTradingDayKey, toEpoch } from "./time";
import { TOPSTEP_CONSISTENCY, type TopstepResult } from "./topstep";
import { ruleIsLiveOn, type DayCompliance } from "./tracker/compliance";
import { WEEKDAY_LABELS, type TrackerRule } from "./tracker-types";
import { formatDuration } from "./units";

/** One fill of a trade, as the mentor pack prints it (`tj_executions`, loaded at export). */
export type MentorFill = {
  side: string;
  qty: number;
  price: number;
  executed_at: string;
};

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

const rr = (r: number | null) => (r == null ? "—" : `${r > 0 ? "+" : ""}${r.toFixed(2)}R`);

/**
 * Šta bi bilo (faza L): mreža SL × TP nad izmerenim trejdovima i šta je cena radila posle izlaza i posle stopa.
 * Prazno kad nijedan trejd nije izmeren — sekcija o ničemu je šum koji model mora da preskoči.
 */
export function scenarioSection(trades: readonly EnrichedTrade[]): string[] {
  const ts = trades.map((t) => scenarioTrade(t.trade.row)).filter((x): x is NonNullable<typeof x> => x != null);
  const s = summarizeScenarios(ts, true);
  if (!s) return [];
  const row = s.cells[s.realRow];
  const j = row.reduce((b, c, k) => (c.meanR > row[b].meanR ? k : b), 0);
  const best = s.best!;
  return [
    `## Šta bi bilo — SL × TP i cena posle izlaza (${s.n} ${sr(s.n, "izmeren trejd", "izmerena trejda", "izmerenih trejdova")}${s.n < SMALL_SAMPLE ? " ⚠" : ""})`,
    `_Svaki trejd ponovljen iz berzanskih sveća od prosečnog ulaza do 15:10 CT, sa SL 0,5–2× stvarnog i TP 1–5R tog SL-a; isti rizik u $, neto posle provizije._`,
    "",
    `| Stavka | Vrednost |`,
    `| --- | --- |`,
    `| Kako sam stvarno vodio trejdove | ${rr(s.actualMeanR)} po trejdu |`,
    `| Najbolja kombinacija | ${s.sl[best.i]}× SL, TP ${s.tp[best.j]}R → ${rr(best.meanR)} po trejdu |`,
    `| Najbolji TP na mom SL-u | ${s.tp[j]}R → ${rr(row[j].meanR)} (planiran TP: medijana ${rr(s.plannedTargetR)}) |`,
    `| Posle stopa došao planirani TP | ${s.afterStop.targetAfter} od ${s.afterStop.n} |`,
    `| SL koji bi preživeo do TP-a | medijana ${rr(s.slForTarget.medianR)}, 8 od 10 do ${rr(s.slForTarget.p80R)} (TP došao u ${s.slForTarget.reached} od ${s.slForTarget.withTarget}) |`,
    `| Posle TP-a nastavilo ≥ 1R | ${s.afterTarget.continuedOneR} od ${s.afterTarget.n} (medijana još ${rr(s.afterTarget.medianFavEodR)}) |`,
    `| Ručni izlaz: da sam držao | TP bi došao ${s.afterHand.wouldHitTarget}, stop bi došao prvi ${s.afterHand.stopFirst} (od ${s.afterHand.n}) |`,
    `| Posle izlaza, 30 min (medijana) | u mom pravcu ${rr(s.afterExit["30"].fav)}, protiv ${rr(s.afterExit["30"].adv)} |`,
    `| U plus pre stopa (medijana / četvrtina preko) | ${rr(s.mfeBeforeStop.medianR)} / ${rr(s.mfeBeforeStop.p75R)} |`,
    "",
  ];
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
    `| Provizije ukupno | ${trades.reduce((s, t) => s + (t.trade.row.stats?.total_fees ?? 0), 0).toFixed(2)} ${ccy} |`,
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

/** How a day's rules read in the pack: a percentage, or why there is none. */
function rulesCell(c: DayCompliance | undefined, ruleText: ReadonlyMap<string, string> | undefined): string {
  if (!c) return "—";
  if (c.status === "unlogged") return "bez prijave";
  if (c.status === "rest") return "ne trguje (odmor)";
  if (c.pct == null) return "—";
  if (c.status === "pending") return `u toku (${Math.round(c.pct)}%)`;
  const missed = c.missedRuleIds.map((id) => ruleText?.get(id) ?? id);
  return `${Math.round(c.pct)}%${missed.length ? ` (${missed.join("; ")})` : ""}`;
}

/**
 * The days a pack covers: every weekday of the period plus any day a trade
 * closed on, oldest first. A day without a trade is still a day the mentor asks
 * about (phase M) — the table used to list trading days only.
 */
export function packDays(trades: readonly EnrichedTrade[], periodDays?: readonly string[]): string[] {
  const set = new Set((periodDays ?? []).filter(isTradingDayKey));
  for (const t of trades) if (t.closeDay) set.add(t.closeDay);
  return [...set].sort();
}

/** One row per day, oldest first — the day is the unit a day trader is judged on. */
export function dailySection(
  trades: readonly EnrichedTrade[],
  ctx: DailyContext & { periodDays?: readonly string[] },
): string[] {
  const byDay = new Map<string, EnrichedTrade[]>();
  for (const t of trades) if (t.closeDay) byDay.set(t.closeDay, [...(byDay.get(t.closeDay) ?? []), t]);
  const keys = packDays(trades, ctx.periodDays);
  if (keys.length === 0) return [];
  const shown = keys.slice(-DAY_ROWS_CAP);
  const out = [
    `## Dnevni pregled (${keys.length} ${sr(keys.length, "dan", "dana", "dana")} u periodu, ${byDay.size} sa trejdovima)`,
    `_Dan = trading dan naloga (Topstep: 17:00–17:00 CT). Pravila = % tvojih pravila iz dnevnog trackera koja su ispoštovana (u zagradi propuštena); „bez prijave“ = nijedan trejd, nijedan odgovor, nijedan izveštaj._`,
    "",
    `| Dan | Trejdova | W/L/BE | Net | R | Prvi ulaz (ET) | Najduži niz gubitaka | Max ugovora | Mentalno | Ne trgujem · zaključan | Pravila | Napomena |`,
    `| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |`,
  ];
  for (const day of shown) {
    const list = byDay.get(day) ?? [];
    const rep = ctx.reportByDate?.get(day);
    const flags = [rep?.no_trade_day ? "da" : null, rep?.locked_at ? "zaključan" : null].filter(Boolean);
    const mental = rep?.mental_temp != null ? `${rep.mental_temp}/5` : "—";
    const rules = rulesCell(ctx.compliance?.get(day), ctx.ruleText);
    const notes: string[] = [];
    if (ctx.dllDays?.has(day)) notes.push("DLL dostignut");
    const inRed = list.filter((t) => redWindowAt(t.openedAt, ctx.briefByDay?.get(t.openDay)) != null).length;
    if (inRed > 0) notes.push(`${inRed} ${sr(inRed, "ulaz", "ulaza", "ulaza")} u crvenom prozoru`);
    const dayNote = ctx.briefByDay?.get(day)?.dayNote;
    if (dayNote) notes.push(dayNote);
    const tail = `${mental} | ${flags.join(" · ") || "—"} | ${cell(rules)} | ${cell(notes.join(", ") || "—")} |`;
    if (list.length === 0) {
      out.push(`| ${day} | 0 | — | — | — | — | — | — | ${tail}`);
      continue;
    }
    const s = computeStats(
      list.map((t) => t.trade),
      "net",
      ctx.range,
    );
    const first = list
      .map((t) => t.openedAt)
      .filter((o): o is string => o != null)
      .sort()[0];
    const sizes = list.map((t) => t.size).filter((v): v is number => v != null);
    out.push(
      `| ${day} | ${list.length} | ${s.wins}/${s.losses}/${s.breakeven} | ${s.netSum.toFixed(2)} | ${r2(s.totalR)}R | ${
        first ? fmtInTz(first, SESSION_TZ, "HH:mm") : "—"
      } | ${longestLossRun(list)} | ${sizes.length ? Math.max(...sizes) : "—"} | ${tail}`,
    );
  }
  if (keys.length > shown.length) {
    out.push("", `_(+${keys.length - shown.length} starijih dana nije prikazano — suzi period.)_`);
  }
  out.push("");
  return out;
}

/**
 * Each day's rules one by one, and the day's news windows (phase M).
 *
 * The daily table gives a percentage; a mentor questioning a day needs which
 * rule held, which broke, which was never answered and which could not be
 * judged — and the brief's windows even when no trade fell in one.
 */
export function trackerByDaySection(
  days: readonly string[],
  rules: readonly TrackerRule[],
  compliance: ReadonlyMap<string, DayCompliance>,
  briefByDay: ReadonlyMap<string, SessionBrief>,
): string[] {
  if (days.length === 0 || rules.length === 0) return [];
  const out = [
    `## Tracker po danu`,
    `_✓ ispunjeno · ✗ prekršeno · ? neodgovoreno · — nije moglo da se oceni (n/a). Crveni prozori i flat su iz jutarnjeg brief-a._`,
    "",
  ];
  for (const day of days.slice(-DAY_ROWS_CAP)) {
    const c = compliance.get(day);
    const tag =
      c?.status === "unlogged"
        ? " · bez prijave"
        : c?.status === "rest"
          ? " · ne trguje (odmor)"
          : c?.status === "pending"
            ? " · u toku"
            : "";
    out.push(`### ${day}${tag}`);
    const brief = briefByDay.get(day);
    if (brief) {
      const windows = brief.redWindows.map(
        (w) =>
          `${fmtInTz(w.from, SESSION_TZ, "HH:mm")}–${fmtInTz(w.to, SESSION_TZ, "HH:mm")} ${cell(w.title)}${w.impact ? ` (${w.impact})` : ""}`,
      );
      const flat = brief.flatBy ? ` · flat do ${fmtInTz(brief.flatBy, SESSION_TZ, "HH:mm")} ET` : "";
      out.push(`- Crveni prozori (ET): ${windows.join("; ") || "nema"}${flat}`);
    } else {
      out.push(`- Brief za ovaj dan nije stigao.`);
    }
    const missed = new Set(c?.missedRuleIds ?? []);
    const unanswered = new Set(c?.unansweredRuleIds ?? []);
    const na = new Set(c?.notApplicableRuleIds ?? []);
    const items = rules
      .filter((r) => ruleIsLiveOn(r, day))
      .map((r) => {
        const name = cell(ruleLabel(r));
        if (unanswered.has(r.id)) return `? ${name} (neodgovoreno)`;
        if (missed.has(r.id)) return `✗ ${name}`;
        if (na.has(r.id) || c?.status === "unlogged" || c == null) return `— ${name} (n/a)`;
        return `✓ ${name}`;
      });
    if (items.length) out.push(`- ${items.join(" · ")}`);
    out.push("");
  }
  return out;
}

/** A Topstep account as the mentor needs it: how far from the end, and by which rule. */
export type MentorTopstep = {
  accountName: string;
  plan: string;
  startingBalance: number;
  /** The trader's risk rule: this share of the room above the MLL per trade. */
  riskRulePct: number | null;
  /**
   * The account's own floor and cap on that risk, where set (Settings ›
   * Accounts). Null falls back to the plan's — the same fallback the budget at
   * entry is computed with (`riskBudgetAt`), so the pack states the range the
   * journal actually sized from. It printed the plan's 60–300 while the account
   * capped at 350 (09.10.2026).
   */
  riskRuleMin?: number | null;
  riskRuleMax?: number | null;
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
      `| Pravilo rizika po trejdu | ${a.riskRulePct == null ? "—" : `${a.riskRulePct}% prostora do MLL-a`}, u granicama ${m(a.riskRuleMin ?? r.rules.riskMin)}–${m(a.riskRuleMax ?? r.rules.riskMax)} |`,
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
  // Today while still open is not judged yet, and a weekday nobody opened is
  // "bez prijave" — both are named, neither is averaged (phase M).
  const judged = compliance.filter((c) => c.pct != null && c.status !== "pending");
  const unlogged = compliance.filter((c) => c.status === "unlogged").map((c) => c.date);
  const rest = compliance.filter((c) => c.status === "rest").map((c) => c.date);
  const open = compliance.filter((c) => c.status === "pending").map((c) => c.date);
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
  }
  if (unlogged.length)
    out.push(
      `Bez prijave (nijedan trejd, nijedan odgovor, nijedan izveštaj): ${unlogged.length} ${sr(unlogged.length, "dan", "dana", "dana")} — ${unlogged.join(", ")}.`,
    );
  if (rest.length)
    out.push(
      `Ne trguje (označeno „Danas ne trgujem“, bez trejda; ne ulazi u prosek): ${rest.length} ${sr(rest.length, "dan", "dana", "dana")} — ${rest.join(", ")}.`,
    );
  if (open.length) out.push(`U toku (ne ulazi u prosek): ${open.join(", ")}.`);
  if (judged.length || unlogged.length || rest.length || open.length) out.push("");
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
    /** The trade's fills, when the export loaded them. */
    fills?: readonly MentorFill[];
    playbookName?: string;
    ccy?: string;
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
  lines.push(...executionLines(e, opts.fills, opts.ccy ?? "USD"));
  if (opts.playbookName) lines.push(`- **Playbook:** ${cell(opts.playbookName)}`);
  const w = redWindowAt(e.openedAt, opts.brief);
  if (w) {
    lines.push(
      `- **Ulaz u crvenom prozoru:** ${cell(w.title)}${w.impact ? ` (${w.impact})` : ""} ${fmtInTz(w.from, SESSION_TZ, "HH:mm")}–${fmtInTz(w.to, SESSION_TZ, "HH:mm")} ET`,
    );
  }
  const sc = scenarioOf(e.trade.row);
  if (sc) {
    const a = afterExitR(sc);
    const posle = [
      a["30"] ? `30 min posle izlaza ${rr(a["30"].fav)} u mom pravcu / ${rr(-a["30"].adv)} protiv` : null,
      sc.exitKind === "stop" && sc.target != null
        ? sc.afterExit.targetMinutes != null
          ? `posle stopa TP došao za ${Math.round(sc.afterExit.targetMinutes)} min`
          : "posle stopa TP nije došao"
        : null,
      sc.exitKind === "other" && sc.target != null
        ? sc.afterExit.stopFirst
          ? "da sam držao, stop bi došao pre TP-a"
          : sc.afterExit.targetMinutes != null
            ? "da sam držao, TP bi došao"
            : "da sam držao, ni TP ni stop do 15:10 CT"
        : null,
      sc.slForTargetR != null ? `SL za TP ${rr(sc.slForTargetR)}` : null,
      `u plus pre stopa ${rr(sc.mfeBeforeStopR)}`,
    ].filter((p): p is string => p != null);
    lines.push(`- **Šta bi bilo:** ${posle.join(" · ")}`);
  }
  if (opts.insightTitles?.length) lines.push(`- **Zapažanja na ovom trejdu:** ${opts.insightTitles.join("; ")}`);
  return lines;
}

const num = (v: unknown): string => String(Number(v));

/**
 * How the trade was actually done (phase M): the fills against the plan, the
 * money split into gross and commissions, the stop and target as sealed against
 * how they ended, and the risk against the budget the rule gave at entry.
 */
function executionLines(e: EnrichedTrade, fills: readonly MentorFill[] | undefined, ccy: string): string[] {
  const row = e.trade.row;
  const st = row.stats;
  const lines: string[] = [];

  const entries = fills ? fills.filter((f) => f.side === "entry").length : e.entryFills;
  const exits = fills ? fills.filter((f) => f.side !== "entry").length : e.exitFills;
  if (st) {
    const parts = [
      st.entry_qty != null && st.avg_entry != null ? `ulaz ${st.entry_qty} @ ${num(st.avg_entry)}` : null,
      st.exit_qty != null && st.avg_exit != null ? `izlaz ${st.exit_qty} @ ${num(st.avg_exit)}` : null,
      st.exit_qty != null && st.entry_qty != null && st.exit_qty < st.entry_qty
        ? `zatvoreno ${st.exit_qty} od ${st.entry_qty}`
        : null,
      st.gross_pl != null ? `gross ${signed(st.gross_pl, ccy)}` : null,
      st.total_fees != null ? `provizije ${st.total_fees.toFixed(2)} ${ccy}` : null,
      `net ${signed(e.pnl, ccy)}`,
      entries + exits > 0 ? `fill-ova ${entries} ulaz / ${exits} izlaz` : null,
    ].filter((p): p is string => p != null);
    lines.push(`- **Izvršenje:** ${parts.join(" · ")}`);
  }

  if (fills && fills.length > 0) {
    const ordered = [...fills].sort((a, b) => toEpoch(a.executed_at) - toEpoch(b.executed_at));
    const dir = String(row.direction ?? "").toLowerCase() === "short" ? -1 : 1;
    const firstEntry = ordered.find((f) => f.side === "entry");
    const shown = ordered.slice(0, 20).map((f) => {
      const against =
        f.side === "entry" && firstEntry != null && f !== firstEntry && (f.price - firstEntry.price) * dir < 0;
      return `${fmtInTz(f.executed_at, SESSION_TZ, "HH:mm:ss")} ${f.side === "entry" ? "ulaz" : "izlaz"} ${f.qty} @ ${num(f.price)}${
        against ? " ⚠ dodato protiv pozicije" : ""
      }`;
    });
    if (ordered.length > shown.length) shown.push(`(+${ordered.length - shown.length})`);
    lines.push(`- **Fill-ovi (ET):** ${shown.join(" · ")}`);
  }

  // Only the keys the seal actually holds: an import seals `{}` (it knew no
  // plan), and reading an absent key as "was empty" printed "stop — → 31196.25"
  // for a stop that was never moved.
  const snapshot = (row as Record<string, unknown>).plan_snapshot as Record<string, unknown> | null | undefined;
  const change = (label: string, key: "stop_price" | "target_price") => {
    if (snapshot == null || !(key in snapshot)) return null;
    const raw = snapshot[key];
    const was = raw == null || raw === "" ? null : Number(raw);
    const now = numberFieldValue(row, key);
    if (was == null && now == null) return null;
    if (was != null && now != null && was === now) return `${label} nepromenjen (${num(now)})`;
    return `${label} ${was == null ? "—" : num(was)} → ${now == null ? "—" : num(now)}`;
  };
  const planParts = [change("stop", "stop_price"), change("cilj", "target_price")].filter(
    (p): p is string => p != null,
  );
  lines.push(
    `- **Plan → kraj:** ${
      planParts.length
        ? planParts.join(" · ")
        : loggedAfterEntry(row)
          ? "upisan posle ulaza — plana pre ulaza nije bilo"
          : "plan nije zapečaćen u journal-u"
    }`,
  );

  // The orders file's last stop against the original, and whether it was moved
  // (phase O). Only with the orders export imported: without it there is no
  // last stop to compare.
  const last = numberFieldValue(row, "final_stop_price");
  if (last != null) {
    const status = stopStatus(row);
    const original = sealedNumber(row, "stop_price");
    const mae = numberFieldValue(row, "max_drawdown_price");
    const parts = [
      `originalni ${original == null ? "—" : num(original)}`,
      `poslednji u platformi ${num(last)}`,
      status === "moved_be"
        ? "pomeren na ulaz / u profit"
        : status === "moved_mae"
          ? `pomeren posle ulaza (cena išla do ${num(mae)}, dalje od poslednjeg)`
          : "nepomeren po izvozu",
      needsOriginalStop(row) ? "⚠ originalni nije upisan sa snimka" : null,
    ].filter((p): p is string => p != null);
    lines.push(`- **Stop:** ${parts.join(" · ")}`);
  }
  const orderType = row.entry_order_type;
  if (typeof orderType === "string" && orderType) lines.push(`- **Ulaz:** ${orderType} nalog`);

  const budget = numberFieldValue(row, "risk_budget_at_entry");
  const room = roomAtEntry(row);
  if (budget != null || room != null) {
    const parts = [
      budget != null ? `budžet ${budget.toFixed(2)} ${ccy}` : null,
      e.riskMoney != null
        ? `uzeto ${e.riskMoney.toFixed(2)} ${ccy}${budget ? ` (${Math.round((e.riskMoney / budget) * 100)}% budžeta)` : ""}`
        : null,
      e.riskPctTaken != null && room != null
        ? `${e.riskPctTaken.toFixed(1)}% prostora do MLL-a (prostor ${room.toFixed(2)} ${ccy})`
        : null,
    ].filter((p): p is string => p != null);
    lines.push(`- **Rizik na ulazu:** ${parts.join(" · ")}`);
  }
  return lines;
}
