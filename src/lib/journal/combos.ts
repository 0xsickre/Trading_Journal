// Client-safe analytics: which combinations of factors (bias + the resolved
// COT / Macro / Vol values across all scopes) produced the best hit-rate.
// Operates on pre-resolved analyses so storage layout is irrelevant here.

import type { ResolvedAnalysis, ResolvedFactor } from "./types";

export type ComboFactor = ResolvedFactor;

export type Combo = {
  factors: ComboFactor[];
  wins: number;
  losses: number;
  total: number; // closed sample size
  winRate: number; // %
};

export type ComboOptions = {
  instrument?: string | null; // null/undefined = all instruments
  minSample?: number; // minimum closed analyses for a combo to show
  size?: number | "all"; // exact combo size, or all sizes 1..maxSize
  maxSize?: number; // upper bound when size === "all"
  limit?: number; // cap on returned combos
};

/** All index combinations of length k from [0..n). */
function* indexCombinations(n: number, k: number): Generator<number[]> {
  const idx = Array.from({ length: k }, (_, i) => i);
  if (k === 0 || k > n) return;
  while (true) {
    yield idx.slice();
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) return;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
}

type Acc = { factors: ComboFactor[]; wins: number; losses: number };

export function bestCombos(
  rows: ResolvedAnalysis[],
  opts: ComboOptions = {},
): Combo[] {
  const {
    instrument = null,
    minSample = 3,
    size = "all",
    maxSize = 3,
    limit = 25,
  } = opts;

  const closed = rows.filter(
    (r) =>
      (r.analysis.status === "win" || r.analysis.status === "loss") &&
      (!instrument || r.analysis.instrument === instrument),
  );

  const sizes =
    size === "all"
      ? Array.from({ length: maxSize }, (_, i) => i + 1)
      : [size];

  const acc = new Map<string, Acc>();

  for (const row of closed) {
    const present = row.factors;
    const won = row.analysis.status === "win";
    for (const k of sizes) {
      if (k > present.length) continue;
      for (const combo of indexCombinations(present.length, k)) {
        const factors = combo.map((i) => present[i]);
        const key = factors.map((f) => `${f.name}=${f.value}`).join("|");
        let entry = acc.get(key);
        if (!entry) {
          entry = { factors, wins: 0, losses: 0 };
          acc.set(key, entry);
        }
        if (won) entry.wins++;
        else entry.losses++;
      }
    }
  }

  const out: Combo[] = [];
  for (const entry of acc.values()) {
    const total = entry.wins + entry.losses;
    if (total < minSample) continue;
    out.push({
      factors: entry.factors,
      wins: entry.wins,
      losses: entry.losses,
      total,
      winRate: (entry.wins / total) * 100,
    });
  }

  out.sort(
    (a, b) =>
      b.winRate - a.winRate ||
      b.total - a.total ||
      a.factors.length - b.factors.length,
  );

  return out.slice(0, limit);
}
