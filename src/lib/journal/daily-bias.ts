// Bias dana (faza D, trejder 17.10.2026): a forecast set before the session, graded from prices.
//
// One row of `tj_daily_bias` is one forecast for one Topstep day and one root (NQ, ES, GC — a
// micro shares its mini's price, so it shares its bias). A change during the day is a NEW row and
// the EARLIEST one is what counts (D-2): a bias that may be rewritten until the price agrees with
// it would grade itself.
//
// The grade is written by futures-trading (`tools/journal_mae.py`) from the exchange's 1m candles:
// the move from max(09:00 Belgrade, set_at) to 18:00 Belgrade, against a neutral band — the 25th
// percentile of the same window's |move| over the 60 trading days before (D-4). The day is
// `neutral` inside the band, `gore` / `dole` outside it. The journal only reads that and counts.
//
// "Uvek long" is graded on THE SAME days, from the same move: it hits when the day was `gore`. A
// directional bias on a neutral day misses, and so does always-long (D-3).

import { BIAS_ROOTS, rootOf, type BiasRoot } from "./default-instruments";
import { isShortDirection } from "./plan-calculations";
import { DEFAULT_TZ, dayKeyIn, fmtInTz, toEpoch, type DayZone } from "./time";
import type { TradeRow } from "./types";

export const BIAS_DIRS = ["gore", "dole", "neutral"] as const;
export type BiasDir = (typeof BIAS_DIRS)[number];

export const BIAS_LABEL: Record<BiasDir, string> = { gore: "Gore", dole: "Dole", neutral: "Neutral" };

/** Below this many graded days the numbers are a story, not a sample (as `SCENARIO_MIN_SAMPLE`). */
export const BIAS_MIN_SAMPLE = 30;

export type BiasEvalStatus = "ok" | "bez_cena" | "bez_istorije" | "prekasno";

export type BiasEval = {
  startAt: string;
  startPrice: number;
  endPrice: number;
  /** End − start, in points. */
  move: number;
  /** The neutral band, ± points. */
  band: number;
  day: BiasDir;
  contract: string | null;
};

export type DailyBias = {
  id: string;
  tradingDay: string;
  root: BiasRoot;
  bias: BiasDir;
  reason: string | null;
  setAt: string;
  /** Null until futures-trading has looked at the day. */
  status: BiasEvalStatus | null;
  /** Present only when `status` is `ok`. */
  eval: BiasEval | null;
};

const isDir = (v: unknown): v is BiasDir => typeof v === "string" && (BIAS_DIRS as readonly string[]).includes(v);
const STATUSES: readonly string[] = ["ok", "bez_cena", "bez_istorije", "prekasno"];
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** One database row, or null when it cannot be read. `numeric` arrives as a string from PostgREST. */
export function parseDailyBias(row: Record<string, unknown>): DailyBias | null {
  const root = (BIAS_ROOTS as readonly string[]).includes(String(row.root)) ? (row.root as BiasRoot) : null;
  if (typeof row.id !== "string" || typeof row.trading_day !== "string" || typeof row.set_at !== "string") return null;
  if (!root || !isDir(row.bias)) return null;
  const status = typeof row.eval_status === "string" && STATUSES.includes(row.eval_status) ? (row.eval_status as BiasEvalStatus) : null;
  let ev: BiasEval | null = null;
  if (status === "ok") {
    const startPrice = num(row.eval_start_price);
    const endPrice = num(row.eval_end_price);
    const move = num(row.eval_move);
    const band = num(row.eval_band);
    if (typeof row.eval_start_at === "string" && startPrice != null && endPrice != null && move != null && band != null && isDir(row.eval_day)) {
      ev = {
        startAt: row.eval_start_at,
        startPrice,
        endPrice,
        move,
        band,
        day: row.eval_day,
        contract: typeof row.eval_contract === "string" ? row.eval_contract : null,
      };
    }
  }
  return {
    id: row.id,
    tradingDay: row.trading_day,
    root,
    bias: row.bias,
    reason: typeof row.reason === "string" && row.reason.trim() !== "" ? row.reason.trim() : null,
    setAt: row.set_at,
    status: status === "ok" && !ev ? null : status,
    eval: ev,
  };
}

/**
 * From this Topstep day the card is THE bias (D-6): the tracker reads it and the trade page no
 * longer asks. Days before it keep what was chosen on the trade — the card did not exist then.
 */
export const BIAS_CARD_SINCE = "2026-10-19";

/** The counted (first) forecast of a day and root, or null. */
export function firstBiasResolver(all: DailyBias[]): (day: string, root: BiasRoot) => DailyBias | null {
  const first = new Map(firstBiases(all).map((b) => [`${b.tradingDay}|${b.root}`, b]));
  return (day, root) => first.get(`${day}|${root}`) ?? null;
}

/** Every forecast of one day and root, earliest first — the first is the one that counts. */
export function biasesOf(all: DailyBias[], day: string, root: BiasRoot): DailyBias[] {
  return all
    .filter((b) => b.tradingDay === day && b.root === root)
    .sort((a, b) => toEpoch(a.setAt) - toEpoch(b.setAt));
}

/** The counted forecast of each (day, root): the earliest. */
export function firstBiases(all: DailyBias[]): DailyBias[] {
  const first = new Map<string, DailyBias>();
  for (const b of all) {
    const key = `${b.tradingDay}|${b.root}`;
    const seen = first.get(key);
    if (!seen || toEpoch(b.setAt) < toEpoch(seen.setAt)) first.set(key, b);
  }
  return [...first.values()].sort((a, b) => a.tradingDay.localeCompare(b.tradingDay) || a.root.localeCompare(b.root));
}

/** Points a forecast earned: the move in its direction, nothing for Neutral. */
export function biasPoints(bias: BiasDir, move: number): number {
  return bias === "gore" ? move : bias === "dole" ? -move : 0;
}

/** "Gore +142 (±61)" — the day as graded. */
export function evalText(ev: BiasEval): string {
  const pts = (n: number) => (Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 100) / 100).toString();
  const sign = ev.move > 0 ? "+" : ev.move < 0 ? "−" : "±";
  return `${BIAS_LABEL[ev.day]} ${sign}${pts(Math.abs(ev.move))} (±${pts(ev.band)})`;
}

/** What the grade says about a forecast in one short line, for the card and the pack. */
export function outcomeText(b: DailyBias): string {
  if (b.eval) return `dan ${evalText(b.eval)} → ${b.bias === b.eval.day ? "pogodak" : "promašaj"}`;
  switch (b.status) {
    case "prekasno":
      return "upisan posle 18:00, ne ocenjuje se";
    case "bez_cena":
      return "nema cena za prozor, ne ocenjuje se";
    case "bez_istorije":
      return "premalo istorije za opseg, ne ocenjuje se";
    default:
      return "čeka cene";
  }
}

/** The first entry on a root, per Topstep day, from the trades OPENED that day. */
export function firstEntryResolver(
  trades: TradeRow[],
  zoneOf: (t: TradeRow) => DayZone,
): (day: string, root: BiasRoot) => string | null {
  const first = new Map<string, string>();
  for (const t of trades) {
    const opened = t.stats?.opened_at;
    const root = rootOf(typeof t.instrument === "string" ? t.instrument : null);
    if (!opened || !root) continue;
    const key = `${dayKeyIn(opened, zoneOf(t))}|${root}`;
    const seen = first.get(key);
    if (!seen || toEpoch(opened) < toEpoch(seen)) first.set(key, opened);
  }
  return (day, root) => first.get(`${day}|${root}`) ?? null;
}

/** "upisano 14:02, posle prvog ulaza (09:24)" — or null when the forecast came first. */
export function biasLateText(b: DailyBias, firstEntryAt: string | null, tz: string = DEFAULT_TZ): string | null {
  if (!firstEntryAt || toEpoch(b.setAt) <= toEpoch(firstEntryAt)) return null;
  return `upisano ${fmtInTz(b.setAt, tz, "HH:mm")}, posle prvog ulaza (${fmtInTz(firstEntryAt, tz, "HH:mm")})`;
}

export type BiasCurvePoint = { day: string; mine: number; long: number };

export type BiasRootStats = {
  /** Graded days: status `ok`, the forecast set before the first entry on this root. */
  n: number;
  hits: number;
  longHits: number;
  points: number;
  longPoints: number;
  /** Cumulative points, one point per graded day, oldest first. */
  curve: BiasCurvePoint[];
};

export type BiasSummary = {
  byRoot: Record<BiasRoot, BiasRootStats>;
  /** Winrates over every root together; points do not add across roots. */
  total: { n: number; hits: number; longHits: number };
  /** Forecasts set after the first entry — counted apart, never graded. */
  late: number;
  /** Not graded yet, or not gradable (no prices, too little history, after 18:00). */
  ungraded: number;
};

const emptyRoot = (): BiasRootStats => ({ n: 0, hits: 0, longHits: 0, points: 0, longPoints: 0, curve: [] });

/** Moj bias against uvek long, on the same days. */
export function summarizeBias(
  all: DailyBias[],
  firstEntryOf: (day: string, root: BiasRoot) => string | null,
): BiasSummary {
  const byRoot = { NQ: emptyRoot(), ES: emptyRoot(), GC: emptyRoot() } as Record<BiasRoot, BiasRootStats>;
  let late = 0;
  let ungraded = 0;
  for (const b of firstBiases(all)) {
    const entry = firstEntryOf(b.tradingDay, b.root);
    if (entry && toEpoch(b.setAt) > toEpoch(entry)) {
      late++;
      continue;
    }
    if (!b.eval) {
      ungraded++;
      continue;
    }
    const s = byRoot[b.root];
    s.n++;
    if (b.bias === b.eval.day) s.hits++;
    if (b.eval.day === "gore") s.longHits++;
    s.points += biasPoints(b.bias, b.eval.move);
    s.longPoints += b.eval.move;
    s.curve.push({ day: b.tradingDay, mine: s.points, long: s.longPoints });
  }
  const total = { n: 0, hits: 0, longHits: 0 };
  for (const r of BIAS_ROOTS) {
    total.n += byRoot[r].n;
    total.hits += byRoot[r].hits;
    total.longHits += byRoot[r].longHits;
  }
  return { byRoot, total, late, ungraded };
}

export type BiasTradeGroup = { n: number; net: number; r: number; rCount: number };
export type BiasTradeSplit = { with: BiasTradeGroup; against: BiasTradeGroup; neutral: BiasTradeGroup; none: BiasTradeGroup };

const emptyGroup = (): BiasTradeGroup => ({ n: 0, net: 0, r: 0, rCount: 0 });

/**
 * The real money by bias: closed trades on a bias root, by whether they went with the day's
 * counted forecast (long on Gore, short on Dole), against it, on a Neutral day, or on a day with
 * no forecast set before the first entry. Net money, R where the trade has it.
 */
export function splitTradesByBias(
  trades: TradeRow[],
  all: DailyBias[],
  zoneOf: (t: TradeRow) => DayZone,
): BiasTradeSplit {
  const firstEntryOf = firstEntryResolver(trades, zoneOf);
  const counted = new Map<string, BiasDir>();
  for (const b of firstBiases(all)) {
    const entry = firstEntryOf(b.tradingDay, b.root);
    if (entry && toEpoch(b.setAt) > toEpoch(entry)) continue;
    counted.set(`${b.tradingDay}|${b.root}`, b.bias);
  }
  const out: BiasTradeSplit = { with: emptyGroup(), against: emptyGroup(), neutral: emptyGroup(), none: emptyGroup() };
  for (const t of trades) {
    const opened = t.stats?.opened_at;
    const root = rootOf(typeof t.instrument === "string" ? t.instrument : null);
    if (!opened || !root || t.status !== "closed" || t.stats?.net_pl == null) continue;
    const bias = counted.get(`${dayKeyIn(opened, zoneOf(t))}|${root}`);
    const short = isShortDirection(typeof t.direction === "string" ? t.direction : null);
    const g =
      bias == null
        ? out.none
        : bias === "neutral"
          ? out.neutral
          : (bias === "gore") !== short
            ? out.with
            : out.against;
    g.n++;
    g.net += Number(t.stats.net_pl);
    const r = t.stats.realized_r;
    if (r != null && Number.isFinite(Number(r))) {
      g.r += Number(r);
      g.rCount++;
    }
  }
  return out;
}

/** "58 % (14/24)" — or "—" with nothing graded. */
export function rateText(hits: number, n: number): string {
  return n === 0 ? "—" : `${Math.round((hits / n) * 100)} % (${hits}/${n})`;
}

/**
 * The mentor pack's "Bias dana" section: one row per day and root in the period — the counted
 * forecast, when it was set, what the prices made of the day — then the two winrates on the same
 * days and the real money by bias. A root traded with no forecast before the first entry is a row
 * too ("nije upisan"), so a missing bias is visible instead of absent.
 */
export function biasPackSection(
  all: DailyBias[],
  trades: TradeRow[],
  zoneOf: (t: TradeRow) => DayZone,
  days: string[],
  ccy: string,
  tz: string = DEFAULT_TZ,
): string[] {
  const inPeriod = new Set(days);
  const biases = all.filter((b) => inPeriod.has(b.tradingDay));
  const firstEntryOf = firstEntryResolver(trades, zoneOf);
  const traded = new Set<string>();
  for (const t of trades) {
    const opened = t.stats?.opened_at;
    const root = rootOf(typeof t.instrument === "string" ? t.instrument : null);
    if (opened && root) traded.add(`${dayKeyIn(opened, zoneOf(t))}|${root}`);
  }
  if (biases.length === 0 && traded.size === 0) return [];

  const out = [
    "## Bias dana (prognoza pre sesije, ocena iz cena)",
    "_Meri se prvi upis dana po korenu (NQ, ES, GC; mikro ima bias mini ugovora): od 09:00 po Beogradu ili od upisa, " +
      "ako je kasnije, do 18:00. Dan je Neutral kad je pomeraj ispod opsega (25. percentil istog prozora u 60 dana). " +
      "„Uvek long“ se ocenjuje na istim danima. Bias upisan posle prvog ulaza se ne broji._",
    "",
    "| Dan | Koren | Bias | Upisano | Ishod |",
    "|---|---|---|---|---|",
  ];
  for (const day of [...days].sort()) {
    for (const root of BIAS_ROOTS) {
      const list = biasesOf(biases, day, root);
      const first = list[0];
      if (!first) {
        if (traded.has(`${day}|${root}`)) out.push(`| ${day} | ${root} | nije upisan | — | trgovao bez biasa |`);
        continue;
      }
      const late = biasLateText(first, firstEntryOf(day, root), tz);
      const changes = list.length > 1 ? ` (+${list.length - 1} promena, meri se prvi)` : "";
      out.push(
        `| ${day} | ${root} | ${BIAS_LABEL[first.bias]}${changes} | ${fmtInTz(first.setAt, tz, "HH:mm")}${late ? `, ${late}` : ""} | ${
          late ? "ne broji se" : outcomeText(first)
        } |`,
      );
    }
  }
  out.push("");

  const s = summarizeBias(biases, firstEntryOf);
  out.push(
    `- **Moj bias:** ${rateText(s.total.hits, s.total.n)} · **Uvek long:** ${rateText(s.total.longHits, s.total.n)} (isti dani)` +
      (s.total.n > 0 && s.total.n < BIAS_MIN_SAMPLE ? ` — mali uzorak (${s.total.n} od ${BIAS_MIN_SAMPLE} dana)` : ""),
  );
  for (const root of BIAS_ROOTS) {
    const r = s.byRoot[root];
    if (r.n === 0) continue;
    const p = (n: number) => `${n > 0 ? "+" : ""}${Math.round(n * 100) / 100}`;
    out.push(`- **${root}:** ${rateText(r.hits, r.n)} prema ${rateText(r.longHits, r.n)}; poeni ${p(r.points)} prema ${p(r.longPoints)}`);
  }
  if (s.late > 0 || s.ungraded > 0) out.push(`- Posle prvog ulaza: ${s.late} · bez ocene: ${s.ungraded}`);
  const split = splitTradesByBias(trades, biases, zoneOf);
  const g = (label: string, x: BiasTradeGroup) =>
    `${label} ${x.n} (net ${Math.round(x.net * 100) / 100} ${ccy}${x.rCount ? `, ${x.r > 0 ? "+" : ""}${Math.round(x.r * 100) / 100}R` : ""})`;
  out.push(
    `- **Trejdovi po biasu:** ${[
      g("u smeru", split.with),
      g("protiv", split.against),
      g("Neutral dan", split.neutral),
      g("bez biasa", split.none),
    ].join(" · ")}`,
  );
  out.push("");
  return out;
}
