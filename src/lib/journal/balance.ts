/**
 * Account balance timeline and drawdown.
 *
 * Two bases, deliberately kept apart:
 *
 *   $ drawdown  — measured on cumulative realized P&L. A withdrawal is not a
 *                 loss, so cash flow must not appear here.
 *   % drawdown  — measured on equity, which is starting balance + realized P&L
 *                 + cash flow. A deposit really does change what a given dollar
 *                 loss means in percentage terms.
 *
 * Collapsing the two gives a percentage that breaks the first time money moves
 * in or out of the account.
 */

import {
  compareInstants,
  daysBetweenDayKeys,
  toEpoch,
  zonedDateKey,
  DEFAULT_TZ,
} from "./time";

export type CashEventType = "deposit" | "withdrawal" | "payout" | "adjustment";

export type CashEvent = {
  id: string;
  account_id: string;
  event_type: CashEventType;
  /** Signed: deposits positive, withdrawals and payouts negative. */
  amount: number;
  occurred_at: string;
  note: string | null;
};

/** Minimal shape of a realized trade — avoids a dependency on analytics.ts. */
export type PnlPoint = { at: string; pnl: number };

export type BalancePoint = {
  at: string;
  /** Cumulative realized P&L. Excludes cash flow. */
  realizedPnl: number;
  /** Cumulative deposits + withdrawals + payouts. */
  cashFlow: number;
  /** starting balance + realizedPnl + cashFlow. */
  equity: number;
  kind: "start" | "trade" | "cash";
};

/**
 * Merge realized trades and cash events into one time-ordered equity series.
 * Both inputs may be unsorted; ties put cash events first so a same-instant
 * deposit is already funded when the trade lands.
 */
export function buildBalanceTimeline(
  startingBalance: number,
  trades: PnlPoint[],
  cashEvents: CashEvent[] = [],
): BalancePoint[] {
  type Ev = { at: string; pnl: number; cash: number; kind: "trade" | "cash" };

  const events: Ev[] = [
    ...trades
      .filter((t) => !!t.at)
      .map((t) => ({ at: t.at, pnl: t.pnl, cash: 0, kind: "trade" as const })),
    ...cashEvents.map((c) => ({
      at: c.occurred_at,
      pnl: 0,
      cash: c.amount,
      kind: "cash" as const,
    })),
  ].sort((a, b) => {
    const byTime = compareInstants(a.at, b.at);
    if (byTime !== 0) return byTime;
    return a.kind === b.kind ? 0 : a.kind === "cash" ? -1 : 1;
  });

  let realizedPnl = 0;
  let cashFlow = 0;

  const out: BalancePoint[] = [
    {
      at: events[0]?.at ?? "",
      realizedPnl: 0,
      cashFlow: 0,
      equity: startingBalance,
      kind: "start",
    },
  ];

  for (const e of events) {
    realizedPnl += e.pnl;
    cashFlow += e.cash;
    out.push({
      at: e.at,
      realizedPnl,
      cashFlow,
      equity: startingBalance + realizedPnl + cashFlow,
      kind: e.kind,
    });
  }

  return out;
}

export type PeriodWindow = {
  /** Equity the account actually held at the start of the window. */
  openingEquity: number;
  /** Cash events inside the window. Earlier ones are folded into the opening. */
  events: CashEvent[];
  /** Realized P&L that happened before the window. */
  priorPnl: number;
};

/**
 * Resolve a time-boxed view of an account.
 *
 * A period filter that narrows the TRADES but not the cash events, and then
 * starts the curve at the full starting balance, produces
 * `starting_balance + 90d of P&L + all-time deposits` — an equity figure for an
 * account that never existed. Peak equity is the denominator of every drawdown
 * percentage, so that error surfaced directly in the headline "Max drawdown %".
 *
 * Both sides are cut at the same instant here, and everything before it is
 * collapsed into the opening equity so the window starts where reality did.
 *
 * `cutoffMs` of null means "all time" and passes everything through.
 */
export function resolvePeriodWindow(
  startingBalance: number,
  trades: PnlPoint[],
  cashEvents: CashEvent[],
  cutoffMs: number | null,
): PeriodWindow {
  if (cutoffMs == null) {
    return { openingEquity: startingBalance, events: cashEvents, priorPnl: 0 };
  }

  let priorPnl = 0;
  for (const t of trades) {
    if (toEpoch(t.at) < cutoffMs) priorPnl += t.pnl;
  }

  let priorCash = 0;
  const events: CashEvent[] = [];
  for (const c of cashEvents) {
    if (toEpoch(c.occurred_at) < cutoffMs) priorCash += c.amount;
    else events.push(c);
  }

  return {
    openingEquity: startingBalance + priorPnl + priorCash,
    events,
    priorPnl,
  };
}

export type DrawdownStats = {
  /** Worst peak-to-trough drop in cumulative P&L. Negative, or 0 when never down. */
  maxMoney: number;
  /** Timestamp of the trough of that worst drop. */
  maxAt: string | null;
  /**
   * Worst drop as a share of peak EQUITY at the time, including cash flow.
   * This is the number to show a human.
   *
   * `0` means "never fell". **`null` means the question has no answer**: the
   * curve fell, and there was no positive peak equity to divide by — an
   * account with no starting balance whose P&L never got above water. The two
   * were one value until Phase E, and the zero they shared scored a perfect
   * 100 on the survival axis for a book that had only ever lost. The same
   * distinction `maxPctOfPeakPnl` below already makes, for the same reason and
   * after the same bug.
   */
  maxPctOfEquity: number | null;
  /**
   * Worst drop as a share of peak cumulative P&L before the drop, per the
   * TradeZella formula. Exists so the composite score stays comparable with
   * theirs — not for display.
   *
   * `0` means "never fell". **`null` means the question has no answer**: the
   * curve fell, but from a peak that was never above zero, so there is no peak
   * profit to express the fall as a share of. Those are not the same statement
   * and they used to be the same number — a book of nothing but losses reported
   * `0`, which the composite score read as a flawless 100 for risk management.
   * A trader in a straight drawdown was told their risk control was perfect.
   */
  maxPctOfPeakPnl: number | null;
  /** Mean depth across every drawdown episode, in money. Negative or 0. */
  avgMoney: number;
  /** How far below the running peak the account sits at the end of the period. */
  currentMoney: number;
  currentPctOfEquity: number;
};

type PeakWalkPoint = {
  point: BalancePoint;
  /** Running high-water mark of cumulative P&L, including this point. */
  peakPnl: number;
  /** Running high-water mark of equity, including this point. */
  peakEquity: number;
  /** How far below the P&L peak this point sits. Always <= 0. */
  dropMoney: number;
  /** True when this point set a new P&L high — i.e. closed a drawdown episode. */
  isNewPeak: boolean;
};

/**
 * Walk the timeline carrying the running peaks.
 *
 * The stats and the plotted series both need exactly this, and each used to
 * track its own peaks. One walk means the KPI and the chart cannot disagree
 * about where a peak was.
 */
function* walkPeaks(timeline: BalancePoint[]): Generator<PeakWalkPoint> {
  let peakPnl = timeline[0]?.realizedPnl ?? 0;
  let peakEquity = timeline[0]?.equity ?? 0;

  for (const point of timeline) {
    const isNewPeak = point.realizedPnl >= peakPnl;
    if (isNewPeak) peakPnl = point.realizedPnl;
    if (point.equity >= peakEquity) peakEquity = point.equity;

    yield {
      point,
      peakPnl,
      peakEquity,
      dropMoney: point.realizedPnl - peakPnl,
      isNewPeak,
    };
  }
}

const EMPTY_DRAWDOWN: DrawdownStats = {
  maxMoney: 0,
  maxAt: null,
  maxPctOfEquity: 0,
  maxPctOfPeakPnl: 0,
  avgMoney: 0,
  currentMoney: 0,
  currentPctOfEquity: 0,
};

export function computeDrawdown(timeline: BalancePoint[]): DrawdownStats {
  if (timeline.length <= 1) return EMPTY_DRAWDOWN;

  let maxMoney = 0;
  let maxAt: string | null = null;
  let maxPctOfEquity: number | null = 0;
  // Starts at 0 — "never fell" — and only becomes null if a fall happens with
  // no positive peak behind it. The two zeros the old code conflated are now
  // the initial 0 (nothing fell) and null (fell, nothing to divide by).
  let maxPctOfPeakPnl: number | null = 0;

  // One "episode" runs from a new peak until the series recovers to that peak.
  const episodeDepths: number[] = [];
  let episodeDepth = 0;
  let lastDrop = 0;
  let peakEquity = 0;

  for (const w of walkPeaks(timeline)) {
    if (w.isNewPeak) {
      if (episodeDepth < 0) episodeDepths.push(episodeDepth);
      episodeDepth = 0;
    }
    if (w.dropMoney < episodeDepth) episodeDepth = w.dropMoney;

    if (w.dropMoney < maxMoney) {
      maxMoney = w.dropMoney;
      maxAt = w.point.at || null;
      maxPctOfEquity =
        w.peakEquity > 0 ? (Math.abs(w.dropMoney) / w.peakEquity) * 100 : null;
      maxPctOfPeakPnl =
        w.peakPnl > 0 ? (Math.abs(w.dropMoney) / w.peakPnl) * 100 : null;
    }

    lastDrop = w.dropMoney;
    peakEquity = w.peakEquity;
  }
  if (episodeDepth < 0) episodeDepths.push(episodeDepth);

  const currentMoney = Math.min(0, lastDrop);
  const currentPctOfEquity =
    peakEquity > 0 ? (Math.abs(currentMoney) / peakEquity) * 100 : 0;

  return {
    maxMoney,
    maxAt,
    maxPctOfEquity,
    maxPctOfPeakPnl,
    avgMoney:
      episodeDepths.length > 0
        ? episodeDepths.reduce((a, b) => a + b, 0) / episodeDepths.length
        : 0,
    currentMoney,
    currentPctOfEquity,
  };
}

/**
 * One drawdown from the peak that started it to the peak that ended it.
 *
 * WHY TIME, NOT ONLY DEPTH. `computeDrawdown` answers how far the curve fell
 * and says nothing about how long it stayed down: −8 % over three days and
 * −8 % over four months render identically today, and for a prop account and
 * for a trader's nerve they are not the same event. Every input is already in
 * the timeline — the walk below only kept the depth and threw the instants
 * away.
 */
export type DrawdownEpisode = {
  /** The peak the fall started from. */
  startAt: string;
  /** The deepest point of the fall. */
  troughAt: string;
  /** The point that regained the peak; null while it never has. */
  recoveredAt: string | null;
  depthMoney: number;
  /** Calendar days from the peak to the recovery, or to the last point when still under. */
  days: number;
  /** Days from the trough to the recovery — how long the climb back took. */
  daysToRecover: number | null;
};

/**
 * Every drawdown episode, in order.
 *
 * Days are counted on CALENDAR DAY KEYS in the account's zone, not on elapsed
 * hours: "eleven days under water" is a statement about days a trader lived
 * through, and 11 × 24 hours would answer a different question at every DST
 * boundary. Same convention as `bookEquityLadder`, which takes its zone the
 * same way.
 */
export function drawdownEpisodes(
  timeline: BalancePoint[],
  tz: string = DEFAULT_TZ,
): DrawdownEpisode[] {
  if (timeline.length <= 1) return [];

  const out: DrawdownEpisode[] = [];
  // The peak an open episode fell from, and the worst point since.
  let startAt: string | null = null;
  let troughAt = "";
  let depth = 0;
  let lastPeakAt = timeline[0]?.at ?? "";
  let lastAt = lastPeakAt;

  const close = (recoveredAt: string | null, endAt: string) => {
    if (startAt == null || depth >= 0) return;
    out.push({
      startAt,
      troughAt,
      recoveredAt,
      depthMoney: depth,
      days: daysBetween(startAt, endAt, tz),
      daysToRecover: recoveredAt ? daysBetween(troughAt, recoveredAt, tz) : null,
    });
    startAt = null;
    depth = 0;
  };

  for (const w of walkPeaks(timeline)) {
    lastAt = w.point.at || lastAt;
    if (w.isNewPeak) {
      // Regaining the peak ends whatever was open, and starts nothing.
      close(w.point.at || null, w.point.at || lastAt);
      lastPeakAt = w.point.at || lastPeakAt;
      continue;
    }
    if (w.dropMoney < 0) {
      if (startAt == null) startAt = lastPeakAt;
      if (w.dropMoney < depth) {
        depth = w.dropMoney;
        troughAt = w.point.at || lastAt;
      }
    }
  }
  // Still under water at the end of the book: a real episode with no recovery.
  close(null, lastAt);

  return out;
}

/** Whole calendar days between two instants, on the account's clock. */
function daysBetween(fromISO: string, toISO: string, tz: string): number {
  const from = zonedDateKey(fromISO, tz);
  const to = zonedDateKey(toISO, tz);
  if (!from || !to) return 0;
  return Math.max(0, daysBetweenDayKeys(from, to));
}

/** The longest stretch under water, and whether the book is under one now. */
export type DrawdownDuration = {
  /** Days of the longest episode, recovered or not. */
  longestDays: number;
  /** Days the current, unrecovered episode has run; 0 when at a peak. */
  currentDays: number;
  /** How long the climb out of the DEEPEST episode took; null if never. */
  daysToRecoverWorst: number | null;
  episodes: number;
};

export function drawdownDuration(episodes: readonly DrawdownEpisode[]): DrawdownDuration {
  if (episodes.length === 0)
    return { longestDays: 0, currentDays: 0, daysToRecoverWorst: null, episodes: 0 };

  const worst = episodes.reduce((a, b) => (b.depthMoney < a.depthMoney ? b : a));
  const open = episodes.find((e) => e.recoveredAt == null);

  return {
    longestDays: Math.max(...episodes.map((e) => e.days)),
    currentDays: open?.days ?? 0,
    daysToRecoverWorst: worst.daysToRecover,
    episodes: episodes.length,
  };
}

export type DrawdownPoint = {
  at: string;
  /** Distance below the running P&L peak, in money. Zero or negative. */
  ddMoney: number;
  /**
   * The same loss as a share of peak equity. Zero or negative (underwater).
   * Note `DrawdownStats` reports its percentages as positive magnitudes; this
   * series is signed because it is plotted.
   */
  ddPct: number;
  equity: number;
};

/**
 * Underwater curve.
 *
 * Both series share a numerator — the drop in cumulative P&L — and differ only
 * in denominator. Measuring the percentage as equity-to-equity instead would
 * make a withdrawal look like a drawdown on the chart while `computeDrawdown`
 * correctly reported none, so the chart and the KPI would contradict each other.
 */
export function drawdownSeries(timeline: BalancePoint[]): DrawdownPoint[] {
  return [...walkPeaks(timeline)].map((w) => ({
    at: w.point.at,
    ddMoney: w.dropMoney,
    ddPct: w.peakEquity > 0 ? (w.dropMoney / w.peakEquity) * 100 : 0,
    equity: w.point.equity,
  }));
}

/** Balance at the end of the timeline — starting balance + P&L + cash flow. */
export function currentEquity(timeline: BalancePoint[]): number {
  return timeline[timeline.length - 1]?.equity ?? 0;
}

/** Net deposits minus withdrawals over the period. */
export function netCashFlow(events: CashEvent[]): number {
  return events.reduce((sum, e) => sum + e.amount, 0);
}
