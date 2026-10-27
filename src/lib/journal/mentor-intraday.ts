/**
 * The day trader's half of the mentor pack (F5.6).
 *
 * The pack was written for a swing book: totals, tag tables and every field of
 * every trade. A model reading it about an intraday futures book could not see
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
import type { TradeRow } from "./types";
import type { PositionRule } from "./playbook-types";
import { gateLateText, gateWrittenAt, opportunitiesOf, opportunityText, stateText } from "./daily-report";
import { loggedAfterEntry, sealedNumber } from "./plan-snapshot";
import { getDimension, type DimensionContext } from "./reports/dimensions";
import { afterExitR, scenarioOf, scenarioTrade, summarizeScenarios } from "./scenario";
import { afterSessionOpen } from "./session-window";
import { numberFieldValue } from "./field-values";
import { needsOriginalStop, stopStatus } from "./stop-moved";
import { DEFAULT_TZ, addDaysToDayKey, fmtInTz, isTradingDayKey, isoWeekdayOfDayKey, toEpoch } from "./time";
import { MINI_OF } from "./default-instruments";
import { SETUP_GRADES, scorable, setupScoreFromTrade } from "./setup-score";
import type { RuleLookup } from "./reports/rule-lookup";
import { ruleIsLiveOn, type DayCompliance } from "./tracker/compliance";
import { WEEKDAY_LABELS, type TrackerRule } from "./tracker-types";
import { computeTimeStop } from "./time-stop";
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
  { key: "session_window", label: "Sesija (po Beogradu)" },
  { key: "minutes_from_open", label: "Koliko posle otvaranja sesije (London / NY)" },
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
  reportByDate: ReadonlyMap<string, DailyReportLite> = new Map(),
): string {
  const dim = getDimension(key);
  if (!dim) return "_nema podataka_";
  const ctx: DimensionContext = { reportByDate: reportByDate as Map<string, DailyReportLite> };
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

/** The state before the session (phase G), as the mentor reads it against the result. */
const STATE_DIMENSIONS: { key: string; label: string }[] = [
  { key: "sleep_quality", label: "Kvalitet sna" },
  { key: "sleep_hours", label: "Sati sna" },
  { key: "work_shift", label: "Smena" },
  { key: "with_child", label: "Dan sa detetom" },
];

/**
 * Results by the state written before the session (phase G, G-2): sleep,
 * shift, child — by the day of the ENTRY. Left out when no day in the period
 * has a state: four tables of "no data" are noise the model reads past.
 */
export function stateSection(
  trades: readonly EnrichedTrade[],
  range: BreakevenRange,
  reportByDate: ReadonlyMap<string, DailyReportLite>,
): string[] {
  if (![...reportByDate.values()].some((r) => stateText(r) != null)) return [];
  const out = [
    `## Stanje pre sesije i rezultat`,
    `_Po danu ulaza; trejd čiji dan nema upisano stanje nije u tabeli. ⚠ = manje od ${SMALL_SAMPLE} trejdova._`,
    "",
  ];
  for (const d of STATE_DIMENSIONS) {
    out.push(`### ${d.label}`, dimensionTable(trades, d.key, range, reportByDate), "");
  }
  return out;
}

/**
 * What each day closed with (phase G): "sutra menjam" and up to three
 * opportunities, the easiest one marked. Days without either are left out.
 */
export function dayCloseSection(
  days: readonly string[],
  reportByDate: ReadonlyMap<string, DailyReportLite>,
): string[] {
  const rows: string[] = [];
  for (const day of days.slice(-DAY_ROWS_CAP)) {
    const rep = reportByDate.get(day);
    const change = rep?.tomorrow_change?.trim();
    const opps = opportunitiesOf(rep?.opportunities);
    if (!change && opps.length === 0) continue;
    rows.push(`### ${day}`);
    if (change) rows.push(`- **Sutra menjam:** ${change}`);
    for (const [i, o] of opps.entries()) rows.push(`- Prilika ${i + 1}: ${opportunityText(o)}`);
    rows.push("");
  }
  if (rows.length === 0) return [];
  return [
    `## Zatvaranje dana (sutra menjam, prilike)`,
    `_Prilike = šta je tržište tog dana ponudilo, po mom upisu (do 3): da li je u playbook-u, da li sam mogao da ga uzmem, i koja je bila najlakša. Bez ulaza, stopa i cilja — ne meri se u R._`,
    "",
    ...rows,
  ];
}

const rr = (r: number | null) => (r == null ? "—" : `${r > 0 ? "+" : ""}${r.toFixed(2)}R`);

/** Contracts in minis: a CME micro is a tenth of its mini (MNQ 1 = NQ 0.1). */
function miniContracts(e: EnrichedTrade): number | null {
  if (e.size == null || !(e.size > 0)) return null;
  const sym = String(e.instrument ?? "").trim().toUpperCase();
  return MINI_OF[sym] ? e.size / 10 : e.size;
}

const mean = (xs: readonly (number | null)[]): number | null => {
  const v = xs.filter((x): x is number => x != null && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const fx = (n: number | null, d = 2) => (n == null ? "—" : n.toFixed(d));
const change = (now: number | null, before: number | null) =>
  now == null || before == null || !(before > 0) ? "—" : `${now >= before ? "+" : ""}${(((now - before) / before) * 100).toFixed(0)} %`;

/**
 * Size by setup grade and by week (phase G, G5): what the sizing literature in
 * the transcripts asks — more on A than on C, and growth in steps of about
 * 10 % — measured, never ruled. Minis are the unit so a micro and a mini read
 * as one book; the risk is the planned stop at the size entered.
 */
export function sizeSection(trades: readonly EnrichedTrade[], rules: RuleLookup | undefined, ccy: string): string[] {
  const sized = trades.filter((e) => miniContracts(e) != null);
  if (sized.length === 0) return [];
  const gradeOf = (e: EnrichedTrade) => (rules ? setupScoreFromTrade(scorable(e), rules)?.grade : undefined) ?? "—";
  const row = (label: string, group: readonly EnrichedTrade[], extra = "") =>
    `| ${label} | ${group.length}${group.length < SMALL_SAMPLE ? " ⚠" : ""} | ${fx(mean(group.map(miniContracts)))} | ${fx(
      mean(group.map((e) => e.riskMoney)),
    )} | ${fx(mean(group.map((e) => e.riskPctTaken)))}${extra} |`;

  const out = [
    `## Size po oceni setupa i po nedeljama`,
    `_Ugovori u mini ekvivalentu (MNQ 1 = NQ 0,1). Rizik = planirani stop × veličina na ulazu (${ccy}) i % balansa dana. Samo merenje, bez pravila._`,
    "",
    `| Ocena setupa | Trejdova | Ø ugovora (mini) | Ø rizik ${ccy} | Ø rizik % |`,
    `|---|---|---|---|---|`,
  ];
  for (const g of [...SETUP_GRADES, "—"]) {
    const group = sized.filter((e) => gradeOf(e) === g);
    if (group.length) out.push(row(g === "—" ? "bez ocene" : g, group));
  }

  const weekOf = (day: string) => addDaysToDayKey(day, -(isoWeekdayOfDayKey(day) - 1));
  const weeks = [...new Set(sized.map((e) => weekOf(e.openDay)))].sort();
  out.push(
    "",
    `| Nedelja (od ponedeljka) | Trejdova | Ø ugovora (mini) | promena | Ø rizik ${ccy} | promena |`,
    `|---|---|---|---|---|---|`,
  );
  let prev: { c: number | null; r: number | null } | null = null;
  for (const w of weeks) {
    const group = sized.filter((e) => weekOf(e.openDay) === w);
    const c = mean(group.map(miniContracts));
    const r = mean(group.map((e) => e.riskMoney));
    out.push(
      `| ${w} | ${group.length}${group.length < SMALL_SAMPLE ? " ⚠" : ""} | ${fx(c)} | ${change(c, prev?.c ?? null)} | ${fx(r)} | ${change(r, prev?.r ?? null)} |`,
    );
    prev = { c, r };
  }
  out.push("");
  return out;
}

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
    `_Svaki trejd ponovljen iz berzanskih sveća od prosečnog ulaza do kraja CME dana (16:00 CT), sa SL 0,5–2× stvarnog i TP 1–5R tog SL-a; isti rizik u $, neto posle provizije._`,
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
  reportByDate?: ReadonlyMap<string, DailyReportLite>;
  /** The zone every time in the pack is written in — the trader's (phase N: Belgrade, never ET). */
  tz?: string;
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
    `_Dan = CME trading dan (17:00 → 17:00 CT, uglavnom 00:00 → 00:00 po Beogradu). Pravila = % tvojih pravila iz dnevnog trackera koja su ispoštovana (u zagradi propuštena); „bez prijave“ = nijedan trejd, nijedan odgovor, nijedan izveštaj._`,
    "",
    `| Dan | Trejdova | W/L/BE | Net | R | Prvi ulaz | Najduži niz gubitaka | Max ugovora | Stanje pre sesije | Ne trgujem · zaključan | Pravila | Napomena |`,
    `| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |`,
  ];
  for (const day of shown) {
    const list = byDay.get(day) ?? [];
    const rep = ctx.reportByDate?.get(day);
    const flags = [rep?.no_trade_day ? "da" : null, rep?.locked_at ? "zaključan" : null].filter(Boolean);
    const firstEntry = list
      .map((t) => t.openedAt)
      .filter((d): d is string => d != null)
      .sort((a, b) => toEpoch(a) - toEpoch(b))[0];
    const writtenAt = gateWrittenAt(rep);
    const late = writtenAt ? gateLateText(writtenAt, firstEntry, ctx.tz ?? DEFAULT_TZ) : null;
    // The state (phase G); a day from before it shows the retired rating.
    const state = stateText(rep) ?? (rep?.mental_temp != null ? `mentalno ${rep.mental_temp}/5` : null);
    const mental = state ? cell(`${state}${late ? ` · ${late}` : ""}`) : "—";
    const rules = rulesCell(ctx.compliance?.get(day), ctx.ruleText);
    const notes: string[] = [];
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
    const sizes = list.map((t) => t.size).filter((v): v is number => v != null);
    out.push(
      `| ${day} | ${list.length} | ${s.wins}/${s.losses}/${s.breakeven} | ${s.netSum.toFixed(2)} | ${r2(s.totalR)}R | ${
        firstEntry ? fmtInTz(firstEntry, ctx.tz ?? DEFAULT_TZ, "HH:mm") : "—"
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
 * Each day's rules one by one (phase M).
 *
 * The daily table gives a percentage; a mentor questioning a day needs which
 * rule held, which broke, which was never answered and which could not be
 * judged. The brief's news windows left in phase X9 (X-10).
 */
export function trackerByDaySection(
  days: readonly string[],
  rules: readonly TrackerRule[],
  compliance: ReadonlyMap<string, DayCompliance>,
): string[] {
  if (days.length === 0 || rules.length === 0) return [];
  const out = [
    `## Tracker po danu`,
    `_✓ ispunjeno · ✗ prekršeno · ? neodgovoreno · — nije moglo da se oceni (n/a)._`,
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

/** The intraday facts of one trade, as lines under its heading in the full detail. */
/** Position id → when its checklist was last answered, for the pack (phase Y). */
export function checklistAnsweredAt(
  positionRules: ReadonlyMap<string, readonly PositionRule[]>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const [id, answers] of positionRules) {
    for (const a of answers) {
      if (!a.created_at) continue;
      const prev = out.get(id);
      if (prev == null || toEpoch(a.created_at) > toEpoch(prev)) out.set(id, a.created_at);
    }
  }
  return out;
}

export function tradeContextLines(
  e: EnrichedTrade,
  opts: {
    displayTz: string;
    insightTitles?: readonly string[];
    accountName?: string;
    /** The trade's fills, when the export loaded them. */
    fills?: readonly MentorFill[];
    playbookName?: string;
    /** When the trade's checklist was last answered (phase Y). */
    checklistAt?: string;
    ccy?: string;
  },
): string[] {
  const lines: string[] = [];
  if (e.openedAt) {
    const after = afterSessionOpen(e.openedAt);
    const parts = [
      `ulaz ${fmtInTz(e.openedAt, opts.displayTz, "dd.MM. HH:mm:ss")}`,
      e.closedAt ? `izlaz ${fmtInTz(e.closedAt, opts.displayTz, "HH:mm:ss")}` : null,
      e.sessionWindow,
      after != null ? `${after.minutes} min posle otvaranja ${after.session === "London" ? "Londona" : "NY"}` : null,
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
  const reakcija = reactionLine(e);
  if (reakcija) lines.push(reakcija);
  lines.push(...executionLines(e, opts.fills, opts.ccy ?? "USD", opts.displayTz));
  if (opts.playbookName) {
    // Phase Y: a playbook written once the outcome was known is a story, not a plan.
    const created = e.trade.row.playbook_created_at;
    const late = typeof created === "string" && e.openedAt != null && toEpoch(created) > toEpoch(e.openedAt);
    lines.push(
      `- **Playbook:** ${cell(opts.playbookName)}${
        late ? ` · napravljen ${fmtInTz(created, opts.displayTz, "dd.MM. HH:mm")}, posle ulaza` : ""
      }`,
    );
  }
  if (opts.checklistAt && e.closedAt && toEpoch(opts.checklistAt) > toEpoch(e.closedAt)) {
    lines.push(`- **Checklist:** upisan ${fmtInTz(opts.checklistAt, opts.displayTz, "dd.MM. HH:mm")}, posle zatvaranja`);
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
            : "da sam držao, ni TP ni stop do kraja dana"
        : null,
      sc.slForTargetR != null ? `SL za TP ${rr(sc.slForTargetR)}` : null,
      `u plus pre stopa ${rr(sc.mfeBeforeStopR)}`,
    ].filter((p): p is string => p != null);
    lines.push(`- **Šta bi bilo:** ${posle.join(" · ")}`);
    const pomeren = tightenedStopLine(e.trade.row, sc.exitKind, sc.slForTargetR, sc.target);
    if (pomeren) lines.push(pomeren);
  }
  if (opts.insightTitles?.length) lines.push(`- **Zapažanja na ovom trejdu:** ${opts.insightTitles.join("; ")}`);
  return lines;
}

/**
 * Koliko je trejdu trebalo da krene (14.10.2026, faza W u paketu): poslednji
 * trenutak u minusu iz R2 sveća (`last_underwater_seconds`). Na dobitniku je to
 * trenutak kad je zauvek prešao u plus; na gubitniku, koliko je od trajanja
 * proveo u minusu. Bez merenja nema reda: procena nije podatak.
 */
function reactionLine(e: EnrichedTrade): string | null {
  const last = numberFieldValue(e.trade.row, "last_underwater_seconds");
  const dur = e.durationSeconds;
  if (e.trade.net < 0) {
    if (e.underwaterPct == null || dur == null) return null;
    return `- **Reakcija:** u minusu ${formatDuration(Math.round((e.underwaterPct / 100) * dur))} od ${formatDuration(dur)} trajanja`;
  }
  if (last == null) return null;
  if (last === 0) return "- **Reakcija:** nijednu sekundu u minusu";
  return `- **Reakcija:** poslednji put u minusu ${formatDuration(last)} posle ulaza, od tada stalno u plusu${dur != null ? ` (trajanje ${formatDuration(dur)})` : ""}`;
}

/**
 * Vremenski stop (faza W) u paketu: za koliko dobitnici krenu, koliko gubitnici
 * stoje u minusu, i lestvica — koliko dobitnika bi sekao rez u minuti N naspram
 * koliko gubitnika je u N još bilo otvoreno (gornja granica onoga što bi rez
 * sačuvao). Prazno kad ništa nije izmereno.
 */
export function timeStopSection(trades: readonly EnrichedTrade[], range: BreakevenRange): string[] {
  const s = computeTimeStop(trades.map((t) => t.trade), range, (t) => t.net);
  if (s.winners + s.losers === 0) return [];
  const d = (sec: number | null) => (sec == null ? "—" : formatDuration(Math.round(sec)));
  const p = (v: number | null) => (v == null ? "—" : `${Math.round(v)}%`);
  const n = s.winners + s.losers;
  return [
    `## Vremenski stop — koliko trejdu treba da krene (${s.winners} ${sr(s.winners, "dobitnik", "dobitnika", "dobitnika")}, ${s.losers} ${sr(s.losers, "gubitnik", "gubitnika", "gubitnika")}${n < SMALL_SAMPLE ? " ⚠" : ""})`,
    "_Iz berzanskih sveća (1 s). Dobitnik „krene“ kad poslednji put izađe iz minusa i više se ne vrati. Gubitnici otvoreni u minuti N su gornja granica onoga što bi rez u N zatvorio ranije._",
    "",
    "| Stavka | Vrednost |",
    "| --- | --- |",
    `| Dobitnici: do trajnog plusa (medijana / 75% / 90%) | ${d(s.medianToGreenSeconds)} / ${d(s.p75ToGreenSeconds)} / ${d(s.p90ToGreenSeconds)} |`,
    `| Dobitnici koji nikad nisu bili u minusu | ${s.winnersNeverRed} od ${s.winners} |`,
    `| Gubitnici: vreme u minusu (medijana / prosek) | ${d(s.medianLoserRedSeconds)} / ${d(s.avgLoserRedSeconds)} |`,
    `| Gubitnici: prosečno trajanje | ${d(s.avgLoserSeconds)} |`,
    "",
    "| Minut N | Dobitnici već u trajnom plusu | Gubitnici još otvoreni |",
    "| --- | --- | --- |",
    ...s.ladder.map((r) => `| ${r.minutes} | ${p(r.winnersGreenPct)} | ${p(r.losersOpenPct)} |`),
    "",
  ];
}

/**
 * Stop pomeren bliže ulazu, pa pogođen (14.10.2026, trejder): da li bi originalni
 * stop preživeo do cilja? `sl_for_target_r` je najmanji SL, u R ORIGINALNOG
 * stopa, koji bi preživeo do prvog izvršenja TP-a — pa ≤ 1R znači da bi trejd sa
 * originalnim stopom bio dobitan. To je cena pomeranja, i ponavlja li se, to je
 * razlog da se prestane.
 */
function tightenedStopLine(
  row: TradeRow,
  exitKind: string | null | undefined,
  slForTargetR: number | null,
  target: number | null | undefined,
): string | null {
  const original = numberFieldValue(row, "stop_price");
  const last = numberFieldValue(row, "final_stop_price");
  const entry = row.stats?.avg_entry ?? null;
  if (original == null || last == null || entry == null || original === last || exitKind !== "stop") return null;
  const dir = String(row.direction ?? "").toLowerCase().startsWith("short") ? -1 : 1;
  // Bliže: poslednji stop je između originalnog i ulaza (ne u profitu — to je druga priča).
  if (!(dir * (last - original) > 0 && dir * (entry - last) > 0)) return null;
  const was = `pogođen pomereni stop ${num(last)} (originalni ${num(original)})`;
  if (target == null) return `- **Pomeren stop:** ${was} · cilja nema, pa se ne zna šta bi originalni doneo`;
  if (slForTargetR != null && slForTargetR <= 1)
    return `- **⚠ Pomeren stop je koštao:** ${was} · sa originalnim stopom TP bi došao (trebalo je SL ${rr(slForTargetR)}, originalni je 1R)`;
  return `- **Pomeren stop:** ${was} · ni originalni ne bi doneo TP (${slForTargetR != null ? `trebalo je SL ${rr(slForTargetR)}` : "TP nije došao do kraja dana"})`;
}

const num = (v: unknown): string => String(Number(v));

/**
 * How the trade was actually done (phase M): the fills against the plan, the
 * money split into gross and commissions, the stop and target as sealed against
 * how they ended, and the risk taken at entry.
 */
function executionLines(e: EnrichedTrade, fills: readonly MentorFill[] | undefined, ccy: string, tz: string): string[] {
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
      return `${fmtInTz(f.executed_at, tz, "HH:mm:ss")} ${f.side === "entry" ? "ulaz" : "izlaz"} ${f.qty} @ ${num(f.price)}${
        against ? " ⚠ dodato protiv pozicije" : ""
      }`;
    });
    if (ordered.length > shown.length) shown.push(`(+${ordered.length - shown.length})`);
    lines.push(`- **Fill-ovi:** ${shown.join(" · ")}`);
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

  if (e.riskMoney != null) {
    const pct = e.riskPctTaken != null ? ` (${e.riskPctTaken.toFixed(2)}% balansa na početku dana)` : "";
    lines.push(`- **Rizik na ulazu:** ${e.riskMoney.toFixed(2)} ${ccy} do stopa${pct}`);
  }
  return lines;
}
