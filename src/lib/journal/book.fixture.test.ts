import { describe, expect, it } from "vitest";
import { computeStats } from "./analytics";
import {
  buildBalanceTimeline,
  computeDrawdown,
  drawdownDuration,
  drawdownEpisodes,
} from "./balance";
import { EXACT_ZERO_RANGE } from "./breakeven";
import { enrichTrades } from "./enriched-trade";
import { avgWinLossRatio, consistencyScore, recoveryFactor } from "./risk-metrics";
import { computeScorecard } from "./scorecard";
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
   * The three axes over exactly the figures derived above.
   *
   *   Survival  drawdown   200 / 500 = 40 %      → 100 − 40    = 60
   *             under water  peak 03-10 → 03-13  → 100 − 3/90  = 96.67
   *                                                    mean    = 78.33
   *   Edge      decided R: 3, −1, 2, −0.5, 1.5, −2, 4, −1.5, 0.5
   *             sum 6 over 9                              = 0.667R
   *   Process   no tracker history, no answered rules     = null
   *
   * The drawdown is over PEAK EQUITY now rather than peak cumulative P&L. On
   * this fixture the two are the same number — the timeline starts at 0, so
   * equity IS cumulative P&L — which is why the 40 % above is unchanged from
   * when the composite used the other base.
   *
   * Process being null is the point of having three numbers instead of one: a
   * book of trades says nothing about whether its trader kept their own rules,
   * and the old composite would have folded that silence into a score anyway.
   */
  const card = () => {
    const dd = drawdown();
    const episodes = drawdownEpisodes(
      buildBalanceTimeline(
        0,
        BOOK.map((t) => ({ at: t.closedAt ?? "", pnl: t.net })),
      ),
      TZ,
    );
    return computeScorecard({
      trackerPct: null,
      followRatePct: null,
      maxDrawdownPctOfEquity: dd.maxPctOfEquity,
      underWaterDays: drawdownDuration(episodes).currentDays,
      decidedRs: BOOK.filter((t) => t.net !== 0).map((t) => t.net / 100),
      trades: BOOK.length,
    });
  };

  it("ends the book under water, three days from the last peak", () => {
    // Trade 7 put the peak at 700 on the 10th; 8, 9 and 10 never got back to
    // it. The book on screen is profitable AND still below its high.
    const episodes = drawdownEpisodes(
      buildBalanceTimeline(
        0,
        BOOK.map((t) => ({ at: t.closedAt ?? "", pnl: t.net })),
      ),
      TZ,
    );
    expect(drawdownDuration(episodes).currentDays).toBe(3);
  });

  it("blends survival out of the depth and the time under water", () => {
    expect(card().survival.score).toBeCloseTo(78.33, 2);
    expect(card().survival.counted).toBe(2);
  });

  it("states the edge as a measurement, with its sample", () => {
    const edge = card().edge;
    expect(edge.expectancyR).toBeCloseTo(6 / 9, 10);
    expect(edge.n).toBe(9);
    // Nine trades spanning −2R to +4R: the interval is far too wide to have
    // ruled out zero, and the card says so rather than printing 0.67R as a
    // finding.
    expect(edge.inconclusive).toBe(true);
  });

  it("has nothing to say about process, and says nothing", () => {
    expect(card().process.score).toBeNull();
  });

  it("calls a ten-trade sample provisional", () => {
    // Real, and thin. The card shows the numbers WITH the sample rather than
    // hiding them or presenting them as settled.
    expect(card().provisional).toBe(true);
    expect(card().trades).toBe(10);
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
  const cardOf = (trades: RealizedTrade[]) => {
    const s = computeStats(trades, "net", EXACT_ZERO_RANGE);
    const dd = computeDrawdown(
      buildBalanceTimeline(
        0,
        trades.map((t) => ({ at: t.closedAt ?? "", pnl: t.net })),
      ),
    );
    return computeScorecard({
      trackerPct: null,
      followRatePct: null,
      maxDrawdownPctOfEquity: dd.maxPctOfEquity,
      underWaterDays: null,
      decidedRs: trades.filter((t) => t.net !== 0).map((t) => t.net / 100),
      trades: s.count,
    });
  };

  it("EMPTY — every statistic is 0 and nothing scores", () => {
    // The reported bug, in its general form. Each zero below is the honest
    // value of its statistic and none of them is a measurement of the trader.
    const s = computeStats([], "net", EXACT_ZERO_RANGE);
    expect(s.netSum).toBe(0);
    expect(s.winRate).toBe(0);
    expect(s.profitFactor).toBeNull(); // this one already knew
    expect(computeDrawdown(buildBalanceTimeline(0, [])).maxPctOfEquity).toBe(0);

    const card = cardOf([]);
    expect(card.survival.score).toBeNull();
    expect(card.edge.expectancyR).toBeNull();
    expect(card.process.score).toBeNull();
  });

  it("ONE WINNER — a perfect drawdown that is an artefact of n=1", () => {
    // A single trade that only went up has a real 0 % drawdown, and scoring it
    // 100 would be the original defect: four maxima, every one of them the
    // sample rather than the trader.
    const card = cardOf(shapedBook([250]));
    expect(card.survival.score).toBeNull();
    expect(card.edge.expectancyR).toBeNull();
  });

  it("ALL WINNERS — an earned hundred, once there are enough of them", () => {
    // Six winners never fell below their peak. That 0 % IS a measurement now,
    // because six clears the sample floor — the distinction the gate exists to
    // make, in its positive direction.
    const card = cardOf(shapedBook([100, 200, 150, 300, 250, 175]));
    expect(card.survival.drawdownPct).toBe(0);
    expect(card.survival.score).toBe(100);
    // And the edge is real: every trade won, so the interval cannot hold zero.
    expect(card.edge.expectancyR!).toBeGreaterThan(0);
    expect(card.edge.inconclusive).toBe(false);
  });

  it("ALL LOSERS — nothing reads as perfect", () => {
    // The worst instance of the old defect, because unlike the other two it
    // needs no empty and no thin account — only a losing streak, which is when
    // a trader most needs the number to be honest. The fall is divided by the
    // peak that preceded it, and a book that never got above water has no such
    // peak. The guard used to answer 0 %, which the score read as
    // `100 - 0 = 100`: six straight losses scored FLAWLESS risk management.
    //
    // Phase E found the same hole surviving on the EQUITY base — this fixture
    // starts its timeline at zero, so there is no starting balance to divide
    // by either — and `maxPctOfEquity` now answers null the way its sibling
    // already did. Survival drops the part instead of scoring it perfect.
    const card = cardOf(shapedBook([-100, -50, -200, -150, -75, -125]));
    expect(card.survival.drawdownPct).toBeNull();
    expect(card.survival.score).toBeNull();
    // What IS measurable on a book of six losses: the edge, and it is negative.
    expect(card.edge.expectancyR!).toBeLessThan(0);
    expect(card.edge.inconclusive).toBe(false);
  });

  it("ALL BREAKEVEN — trades to measure, no decisions to have won", () => {
    // The case that makes one sample count wrong: six trades, zero decided.
    // Survival has a series to work on; the edge has no population at all.
    const card = cardOf(shapedBook([0, 0, 0, 0, 0, 0]));
    expect(card.survival.score).not.toBeNull();
    expect(card.edge.n).toBe(0);
    expect(card.edge.expectancyR).toBeNull();
    expect(card.edge.inconclusive).toBe(true);
  });
});
