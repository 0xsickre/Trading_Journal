import { describe, expect, it } from "vitest";
import { computeStats } from "./analytics";
import { buildBalanceTimeline, computeDrawdown } from "./balance";
import { EXACT_ZERO_RANGE } from "./breakeven";
import { enrichTrades } from "./enriched-trade";
import { avgWinLossRatio, consistencyScore, recoveryFactor } from "./risk-metrics";
import { computeSickreScore } from "./sickre-score";
import { BOOK, BOOK_NET, CLOSE_DAYS, TZ, shapedBook } from "./book.fixture";
import type { RealizedTrade } from "./analytics";

/**
 * A BOOK, WITH EVERY NUMBER COMPUTED BY HAND.
 *
 * Every other test in this suite checks a function against its contract:
 * *given these inputs, does the arithmetic work.* That is necessary and it is
 * not sufficient, and the proof is on the record — `sickre-score.ts` sat at
 * 96 % statement and **100 % function** coverage with thirteen passing tests
 * while it displayed 33/100 with "Max drawdown: 100" on an account holding no
 * trades at all. The formula was right. What reached it was wrong, and no
 * amount of testing the formula against invented inputs could have said so.
 *
 * So this file inverts the question. It fixes ONE book of ten trades, derives
 * every headline figure from it on paper — in the comments, arithmetic visible
 * — and then asserts that the code agrees. A number here is wrong if it
 * disagrees with the paper, not if it disagrees with what the code used to say.
 * That distinction is the entire point: a snapshot test pins current behaviour
 * including its bugs, and this pins the answer.
 *
 * The second half sweeps the SHAPES a book can have — empty, one trade, all
 * winners, all losers, all breakeven — because that empty-account defect was
 * one member of that family and the other five were never looked at.
 *
 * Timezone is America/New_York throughout, so the day keys exercise the real
 * zone conversion rather than a UTC identity.
 *
 * The book itself lives in `book.fixture.ts`, shared with
 * `dashboard.render.test.tsx` — the same figures derived here on paper are
 * asserted there against the actual rendered screen.
 */

const stats = () => computeStats(BOOK, "net", EXACT_ZERO_RANGE);

const drawdown = () =>
  computeDrawdown(
    buildBalanceTimeline(
      0,
      BOOK.map((t) => ({ at: t.closedAt ?? "", pnl: t.net })),
    ),
  );

describe("the book, counted", () => {
  it("adds the trades up the way they add up on paper", () => {
    // 300 − 100 + 200 − 50 + 150 − 200 + 400 − 150 + 0 + 50 = 600
    const s = stats();
    expect(s.netSum).toBe(600);
    expect(s.count).toBe(10);
  });

  it("splits wins, losses and breakeven on the account's band", () => {
    // Winners: 300, 200, 150, 400, 50 → 5.  Losers: 100, 50, 200, 150 → 4.
    // The 0 is neither, and EXACT_ZERO_RANGE is what decides that.
    const s = stats();
    expect(s.wins).toBe(5);
    expect(s.losses).toBe(4);
    expect(s.breakeven).toBe(1);
  });

  it("keeps breakeven OUT of the win-rate denominator", () => {
    // 5 / 9, not 5 / 10. Counting the scratch as a loss would read 50 % and
    // understate the book by five and a half points.
    const s = stats();
    expect(s.winRate).toBeCloseTo((5 / 9) * 100, 10);
    expect(s.winRate).toBeCloseTo(55.5556, 4);
  });

  it("divides gross profit by gross loss", () => {
    // Gross profit 300+200+150+400+50 = 1100.  Gross loss 100+50+200+150 = 500.
    // 1100 / 500 = 2.2 — exactly a band floor in RATIO_BANDS.
    expect(stats().profitFactor).toBeCloseTo(2.2, 10);
  });

  it("averages winners and losers in money over their own counts", () => {
    // 1100 / 5 = 220.   −500 / 4 = −125.
    const s = stats();
    expect(s.avgWinMoney).toBeCloseTo(220, 10);
    expect(s.avgLossMoney).toBeCloseTo(-125, 10);
  });

  it("totals R off the trades", () => {
    // r is net/100 here: 3, −1, 2, −0.5, 1.5, −2, 4, −1.5, 0, 0.5 → 6.
    const s = stats();
    expect(s.totalR).toBeCloseTo(6, 10);
    expect(s.avgR).toBeCloseTo(0.6, 10);
  });

  it("names the best and the worst trade", () => {
    const s = stats();
    expect(s.best).toBe(400);
    expect(s.worst).toBe(-200);
  });
});

describe("the book, walked", () => {
  it("finds the deepest peak-to-trough, not the largest single loss", () => {
    // The worst SINGLE trade is −200 and the worst DRAWDOWN is also 200 here,
    // but they are different quantities and the table above shows why: the
    // drop is measured from the running peak of 500, not from zero.
    expect(drawdown().maxMoney).toBe(-200);
  });

  it("dates the trough to the trade that caused it", () => {
    expect(drawdown().maxAt).toBe("2026-03-09T18:00:00Z");
  });

  it("expresses the drawdown over the PEAK P&L that preceded it", () => {
    // 200 / 500 = 40 %. Not 200/600 (the final total) and not 200/700 (the
    // later peak) — the peak at the time of the drop is the denominator.
    expect(drawdown().maxPctOfPeakPnl).toBeCloseTo(40, 10);
  });

  it("recovers 3.0 times the drawdown", () => {
    // Net 600 over drawdown 200 = 3.0 — exactly a RECOVERY_BANDS floor.
    expect(recoveryFactor(600, -200)).toBeCloseTo(3, 10);
  });

  it("rates average win against average loss", () => {
    // 220 / 125 = 1.76. Below the 1.8 floor, so it scores the bottom band —
    // a book that is profitable overall can still fail this ratio, and does.
    expect(avgWinLossRatio(220, -125)).toBeCloseTo(1.76, 10);
  });

  it("scores consistency off the dispersion of the trades", () => {
    // mean 60; deviations 240 −160 140 −110 90 −260 340 −210 −60 −10;
    // squares sum to 354 000; variance 35 400; stdev √35400 ≈ 188.1489.
    // cv = 188.1489 / 60 ≈ 3.13582 → 100 − 3.13582×20 ≈ 37.28.
    const c = consistencyScore(BOOK_NET);
    expect(c.mean).toBeCloseTo(60, 10);
    expect(c.stdev).toBeCloseTo(Math.sqrt(35_400), 8);
    expect(c.score).toBeCloseTo(37.28, 2);
  });
});

describe("the book, attributed to days", () => {
  const enriched = enrichTrades(BOOK, { tzOf: () => TZ });

  it("dates money by the CLOSE and the decision by the OPEN", () => {
    // Trade 7 spans Monday to Tuesday. Its +400 belongs to Tuesday the 10th;
    // the choice to take it belongs to Monday the 9th. Attributing either to
    // the other day misfiles the P&L calendar and the tracker at once.
    const t7 = enriched.find((e) => e.trade.id === "b7")!;
    expect(t7.closeDay).toBe("2026-03-10");
    expect(t7.openDay).toBe("2026-03-09");
  });

  it("puts every trade on the New York day, not the UTC one", () => {
    expect(enriched.map((e) => e.closeDay)).toEqual(CLOSE_DAYS);
  });

  it("crosses the DST change without moving a trade", () => {
    // US DST began 8 March 2026. Trades 5 and 6 straddle it at the same UTC
    // instant of day, and must stay on the days the table says.
    expect(enriched[4].closeDay).toBe("2026-03-06"); // EST
    expect(enriched[5].closeDay).toBe("2026-03-09"); // EDT
  });
});

describe("the book, scored", () => {
  /**
   * The Sickre Score over exactly the figures derived above.
   *
   *   profit factor  2.20  → RATIO_BANDS floor 2.2      → 80      × 25 = 2000
   *   avg win/loss   1.76  → below the 1.8 floor        → 20      × 20 =  400
   *   max drawdown     40% → 100 − 40                   → 60      × 20 = 1200
   *   win %         55.56% → 55.5556 / 60 × 100         → 92.5926 × 15 = 1388.89
   *   recovery        3.00 → RECOVERY_BANDS floor 3.0   → 70      × 10 =  700
   *   consistency    37.28 → carried through as-is      → 37.2837 × 10 =  372.84
   *                                                        total  6061.73 / 100
   */
  const score = () => {
    const s = stats();
    const dd = drawdown();
    return computeSickreScore({
      profitFactor: s.profitFactor,
      avgWinLossRatio: avgWinLossRatio(s.avgWinMoney, s.avgLossMoney),
      maxDrawdownPctOfPeakPnl: dd.maxPctOfPeakPnl,
      winPct: s.winRate,
      recoveryFactor: recoveryFactor(s.netSum, dd.maxMoney),
      consistencyScore: consistencyScore(BOOK_NET).score,
      sample: { trades: s.count, decided: s.wins + s.losses },
    });
  };

  it("scores each component where the band table puts it", () => {
    const by = Object.fromEntries(
      score().components.map((c) => [c.key, c.score]),
    );
    expect(by.profitFactor).toBeCloseTo(80, 6);
    expect(by.avgWinLoss).toBeCloseTo(20, 6);
    expect(by.maxDrawdown).toBeCloseTo(60, 6);
    expect(by.winPct).toBeCloseTo(92.5926, 3);
    expect(by.recovery).toBeCloseTo(70, 6);
    expect(by.consistency).toBeCloseTo(37.2837, 3);
  });

  it("weights them into the number on the card", () => {
    expect(score().score).toBeCloseTo(60.62, 2);
    expect(score().coverage).toBe(100);
  });

  it("calls a ten-trade sample provisional, and says so with the n", () => {
    // Real, and thin. The card shows the score WITH its sample rather than
    // hiding it or presenting it as settled.
    expect(score().confidence).toEqual({ level: "provisional", trades: 10 });
  });
});

/**
 * The shapes a book can take.
 *
 * The empty-account defect was one member of this family. These are the other
 * five, checked once each against the figure that would be a lie.
 */
describe("the shapes a book can take", () => {
  // `shapedBook` lives in `book.fixture.ts`, shared with the render test.
  const scoreOf = (trades: RealizedTrade[], nets: number[]) => {
    const s = computeStats(trades, "net", EXACT_ZERO_RANGE);
    const dd = computeDrawdown(
      buildBalanceTimeline(
        0,
        trades.map((t) => ({ at: t.closedAt ?? "", pnl: t.net })),
      ),
    );
    return computeSickreScore({
      profitFactor: s.profitFactor,
      avgWinLossRatio: avgWinLossRatio(s.avgWinMoney, s.avgLossMoney),
      maxDrawdownPctOfPeakPnl: dd.maxPctOfPeakPnl,
      winPct: s.winRate,
      recoveryFactor: recoveryFactor(s.netSum, dd.maxMoney),
      consistencyScore: consistencyScore(nets).score,
      sample: { trades: s.count, decided: s.wins + s.losses },
    });
  };

  it("EMPTY — every statistic is 0 and the score refuses to exist", () => {
    // The reported bug, in its general form. Each zero below is the honest
    // value of its statistic and none of them is a measurement of the trader.
    const s = computeStats([], "net", EXACT_ZERO_RANGE);
    expect(s.netSum).toBe(0);
    expect(s.winRate).toBe(0);
    expect(s.profitFactor).toBeNull(); // this one already knew
    expect(computeDrawdown(buildBalanceTimeline(0, [])).maxPctOfPeakPnl).toBe(0);

    const r = scoreOf([], []);
    expect(r.score).toBeNull();
    expect(r.components.every((c) => !c.counted)).toBe(true);
  });

  it("ONE WINNER — four components peak, and none of them counts", () => {
    const r = scoreOf(shapedBook([250]), [250]);
    expect(r.score).toBeNull();
    expect(r.confidence).toEqual({
      level: "withheld",
      reason: "sample",
      tradesShort: 4,
    });
  });

  it("ALL WINNERS — infinite profit factor is kept, ratios with no loser are dropped", () => {
    // A real, maximal profit factor: winners and no losses. It scores the top
    // band rather than being mistaken for missing data. Avg win/loss and
    // recovery have no denominator at all and drop out honestly.
    const nets = [100, 200, 150, 300, 250, 175];
    const r = scoreOf(shapedBook(nets), nets);
    const by = Object.fromEntries(r.components.map((c) => [c.key, c]));
    expect(by.profitFactor.value).toBe(Infinity);
    expect(by.profitFactor.score).toBe(100);
    expect(by.avgWinLoss.counted).toBe(false);
    expect(by.recovery.counted).toBe(false);
    expect(by.maxDrawdown.score).toBe(100); // never fell below its peak — earned
    expect(r.score).not.toBeNull();
  });

  it("ALL LOSERS — nothing reads as perfect", () => {
    // The third instance of the same defect, and the worst, because unlike the
    // other two it needs no empty and no thin account — only a losing streak,
    // which is when a trader most needs the number to be honest.
    //
    // `maxPctOfPeakPnl` divides the fall by the peak profit that preceded it.
    // A book that never rose above zero has no such peak, and the guard
    // `peakPnl > 0 ? … : 0` answered **0 %** — which the score read as
    // `100 - 0 = 100`. Six straight losses scored FLAWLESS risk management.
    //
    // It is now null: the fall is real and the percentage has no denominator,
    // so the component drops instead of inventing a perfect one.
    const nets = [-100, -50, -200, -150, -75, -125];
    const dd = computeDrawdown(
      buildBalanceTimeline(
        0,
        shapedBook(nets).map((t) => ({ at: t.closedAt ?? "", pnl: t.net })),
      ),
    );
    expect(dd.maxMoney).toBe(-700); // it really did fall, all the way
    expect(dd.maxPctOfPeakPnl).toBeNull(); // and there is no peak to divide by

    const r = scoreOf(shapedBook(nets), nets);
    const by = Object.fromEntries(r.components.map((c) => [c.key, c]));
    expect(by.profitFactor.score).toBe(20); // bottom band
    expect(by.winPct.score).toBe(0);
    expect(by.consistency.score).toBe(0); // a losing book has no consistency
    expect(by.maxDrawdown.counted).toBe(false); // NOT 100
    expect(r.score!).toBeLessThan(20);
  });

  it("keeps 0 % for a book that genuinely never fell", () => {
    // The distinction the null exists to make. Rising the whole way is a real
    // 0 % drawdown and must keep scoring 100 — otherwise the fix would have
    // traded one lie for another.
    const dd = computeDrawdown(
      buildBalanceTimeline(
        0,
        shapedBook([100, 200, 150]).map((t) => ({ at: t.closedAt ?? "", pnl: t.net })),
      ),
    );
    expect(dd.maxMoney).toBe(0);
    expect(dd.maxPctOfPeakPnl).toBe(0);
  });

  it("ALL BREAKEVEN — trades to measure, no decisions to have won", () => {
    // The case that makes one sample count wrong: six trades, zero decided.
    // Drawdown and consistency have a series to work on; win rate, profit
    // factor and avg win/loss have no denominator and must drop.
    const nets = [0, 0, 0, 0, 0, 0];
    const r = scoreOf(shapedBook(nets), nets);
    const by = Object.fromEntries(r.components.map((c) => [c.key, c]));
    expect(by.winPct.counted).toBe(false);
    expect(by.profitFactor.counted).toBe(false);
    expect(by.avgWinLoss.counted).toBe(false);
    expect(by.maxDrawdown.counted).toBe(true);
    // Six flat trades are not a composite of anything worth a headline.
    expect(r.score).toBeNull();
    expect(r.confidence).toEqual({
      level: "withheld",
      reason: "coverage",
      tradesShort: 0,
    });
  });

  it("OPEN POSITIONS ONLY — an unclosed trade is not a realized result", () => {
    // `toRealized` is what decides this upstream; here the guard is that a
    // book of trades with no close date produces no money statistics rather
    // than a set of zeros presented as a flat month.
    const open = shapedBook([0, 0, 0]).map((t) => ({ ...t, closedAt: null }));
    const s = computeStats(open, "net", EXACT_ZERO_RANGE);
    expect(s.count).toBe(3);
    expect(s.netSum).toBe(0);
    // No close instant means no day to file the money under, which is what
    // keeps an open position out of every dated total.
    const enriched = enrichTrades(open, { tzOf: () => TZ });
    expect(enriched.every((e) => e.closeDay === "")).toBe(true);
  });
});
