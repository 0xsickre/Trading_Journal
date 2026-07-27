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
    const byTime = a.at.localeCompare(b.at);
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

export type DrawdownStats = {
  /** Worst peak-to-trough drop in cumulative P&L. Negative, or 0 when never down. */
  maxMoney: number;
  /** Timestamp of the trough of that worst drop. */
  maxAt: string | null;
  /**
   * Worst drop as a share of peak EQUITY at the time, including cash flow.
   * This is the number to show a human.
   */
  maxPctOfEquity: number;
  /**
   * Worst drop as a share of peak cumulative P&L before the drop, per the
   * TradeZella formula. Exists so the composite score stays comparable with
   * theirs — not for display.
   */
  maxPctZella: number;
  /** Mean depth across every drawdown episode, in money. Negative or 0. */
  avgMoney: number;
  /** How far below the running peak the account sits at the end of the period. */
  currentMoney: number;
  currentPctOfEquity: number;
};

const EMPTY_DRAWDOWN: DrawdownStats = {
  maxMoney: 0,
  maxAt: null,
  maxPctOfEquity: 0,
  maxPctZella: 0,
  avgMoney: 0,
  currentMoney: 0,
  currentPctOfEquity: 0,
};

export function computeDrawdown(timeline: BalancePoint[]): DrawdownStats {
  if (timeline.length <= 1) return EMPTY_DRAWDOWN;

  let peakPnl = timeline[0].realizedPnl;
  let peakEquity = timeline[0].equity;

  let maxMoney = 0;
  let maxAt: string | null = null;
  let maxPctOfEquity = 0;
  let maxPctZella = 0;

  // One "episode" runs from a new peak until the series recovers to that peak.
  const episodeDepths: number[] = [];
  let episodeDepth = 0;

  for (const p of timeline) {
    if (p.realizedPnl >= peakPnl) {
      if (episodeDepth < 0) episodeDepths.push(episodeDepth);
      episodeDepth = 0;
      peakPnl = p.realizedPnl;
    }
    if (p.equity >= peakEquity) peakEquity = p.equity;

    const dropMoney = p.realizedPnl - peakPnl; // <= 0
    if (dropMoney < episodeDepth) episodeDepth = dropMoney;

    if (dropMoney < maxMoney) {
      maxMoney = dropMoney;
      maxAt = p.at || null;
      maxPctOfEquity =
        peakEquity > 0 ? (Math.abs(dropMoney) / peakEquity) * 100 : 0;
      maxPctZella = peakPnl > 0 ? (Math.abs(dropMoney) / peakPnl) * 100 : 0;
    }
  }
  if (episodeDepth < 0) episodeDepths.push(episodeDepth);

  const last = timeline[timeline.length - 1];
  const currentMoney = Math.min(0, last.realizedPnl - peakPnl);
  const currentPctOfEquity =
    peakEquity > 0 ? (Math.abs(currentMoney) / peakEquity) * 100 : 0;

  return {
    maxMoney,
    maxAt,
    maxPctOfEquity,
    maxPctZella,
    avgMoney:
      episodeDepths.length > 0
        ? episodeDepths.reduce((a, b) => a + b, 0) / episodeDepths.length
        : 0,
    currentMoney,
    currentPctOfEquity,
  };
}

/** Balance at the end of the timeline — starting balance + P&L + cash flow. */
export function currentEquity(timeline: BalancePoint[]): number {
  return timeline[timeline.length - 1]?.equity ?? 0;
}

/** Net deposits minus withdrawals over the period. */
export function netCashFlow(events: CashEvent[]): number {
  return events.reduce((sum, e) => sum + e.amount, 0);
}
