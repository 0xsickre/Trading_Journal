import { describe, expect, it } from "vitest";
import {
  buildBalanceTimeline,
  computeDrawdown,
  currentEquity,
  drawdownDuration,
  drawdownEpisodes,
  drawdownSeries,
  netCashFlow,
  resolvePeriodWindow,
  type CashEvent,
} from "./balance";

const trade = (at: string, pnl: number) => ({ at, pnl });

const cash = (
  at: string,
  amount: number,
  event_type: CashEvent["event_type"] = amount > 0 ? "deposit" : "withdrawal",
): CashEvent => ({
  id: at + amount,
  account_id: "acc",
  event_type,
  amount,
  occurred_at: at,
  note: null,
});

describe("buildBalanceTimeline", () => {
  it("starts at the starting balance before any event", () => {
    const tl = buildBalanceTimeline(10_000, [], []);
    expect(tl).toHaveLength(1);
    expect(tl[0].equity).toBe(10_000);
  });

  it("keeps cash flow out of realized P&L", () => {
    const tl = buildBalanceTimeline(
      10_000,
      [trade("2026-01-02T00:00:00Z", 500)],
      [cash("2026-01-03T00:00:00Z", 5_000)],
    );
    const last = tl[tl.length - 1];
    expect(last.realizedPnl).toBe(500);
    expect(last.cashFlow).toBe(5_000);
    expect(last.equity).toBe(15_500);
  });

  it("sorts unsorted input and funds a same-instant deposit first", () => {
    const at = "2026-01-02T00:00:00Z";
    const tl = buildBalanceTimeline(
      1_000,
      [trade(at, -100), trade("2026-01-01T00:00:00Z", 50)],
      [cash(at, 500)],
    );
    expect(tl.map((p) => p.kind)).toEqual([
      "start",
      "trade",
      "cash",
      "trade",
    ]);
    expect(currentEquity(tl)).toBe(1_450);
  });

  it("subtracts withdrawals and payouts", () => {
    const tl = buildBalanceTimeline(
      10_000,
      [],
      [cash("2026-02-01T00:00:00Z", -2_000, "payout")],
    );
    expect(currentEquity(tl)).toBe(8_000);
  });
});

describe("computeDrawdown", () => {
  it("returns zeros for an empty timeline", () => {
    const dd = computeDrawdown(buildBalanceTimeline(10_000, [], []));
    expect(dd.maxMoney).toBe(0);
    expect(dd.maxPctOfEquity).toBe(0);
  });

  it("measures the worst peak-to-trough drop in money and dates it", () => {
    const tl = buildBalanceTimeline(10_000, [
      trade("2026-01-01T00:00:00Z", 1_000), // peak +1000
      trade("2026-01-02T00:00:00Z", -400),
      trade("2026-01-03T00:00:00Z", -300), // trough +300, drop -700
      trade("2026-01-04T00:00:00Z", 900), // recovers to +1200
    ]);
    const dd = computeDrawdown(tl);
    expect(dd.maxMoney).toBe(-700);
    expect(dd.maxAt).toBe("2026-01-03T00:00:00Z");
  });

  it("leaves the money drawdown untouched by a deposit but moves the percentage", () => {
    const trades = [
      trade("2026-01-01T00:00:00Z", 1_000),
      trade("2026-01-03T00:00:00Z", -700),
    ];
    const without = computeDrawdown(buildBalanceTimeline(10_000, trades, []));
    const withDeposit = computeDrawdown(
      buildBalanceTimeline(10_000, trades, [
        cash("2026-01-02T00:00:00Z", 90_000),
      ]),
    );

    // Same dollars lost either way.
    expect(withDeposit.maxMoney).toBe(without.maxMoney);
    // But -700 against an 11k account is not the same as against a 101k account.
    expect(without.maxPctOfEquity).toBeCloseTo(6.364, 3);
    expect(withDeposit.maxPctOfEquity).toBeCloseTo(0.693, 3);
  });

  it("computes the peak-P&L base off cumulative P&L, not equity", () => {
    const dd = computeDrawdown(
      buildBalanceTimeline(10_000, [
        trade("2026-01-01T00:00:00Z", 1_000),
        trade("2026-01-02T00:00:00Z", -500),
      ]),
    );
    // 500 / 1000 = 50 %, independent of the 10k starting balance.
    expect(dd.maxPctOfPeakPnl).toBe(50);
    expect(dd.maxPctOfEquity).toBeCloseTo(4.545, 3);
  });

  it("averages across drawdown episodes, not across every point", () => {
    const dd = computeDrawdown(
      buildBalanceTimeline(0, [
        trade("2026-01-01T00:00:00Z", 100), // peak 100
        trade("2026-01-02T00:00:00Z", -20), // episode 1 depth -20
        trade("2026-01-03T00:00:00Z", 50), // new peak 130
        trade("2026-01-04T00:00:00Z", -60), // episode 2 depth -60
        trade("2026-01-05T00:00:00Z", 100), // new peak
      ]),
    );
    expect(dd.avgMoney).toBe(-40);
    expect(dd.maxMoney).toBe(-60);
  });

  it("reports the open drawdown at the end of the period", () => {
    const dd = computeDrawdown(
      buildBalanceTimeline(10_000, [
        trade("2026-01-01T00:00:00Z", 1_000),
        trade("2026-01-02T00:00:00Z", -250),
      ]),
    );
    expect(dd.currentMoney).toBe(-250);
    expect(dd.currentPctOfEquity).toBeCloseTo(2.273, 3);
  });

  it("is zero when the curve only goes up", () => {
    const dd = computeDrawdown(
      buildBalanceTimeline(10_000, [
        trade("2026-01-01T00:00:00Z", 100),
        trade("2026-01-02T00:00:00Z", 200),
      ]),
    );
    expect(dd.maxMoney).toBe(0);
    expect(dd.currentMoney).toBe(0);
    expect(dd.avgMoney).toBe(0);
  });
});

describe("drawdownSeries", () => {
  it("stays at zero while making new highs and goes underwater after", () => {
    const series = drawdownSeries(
      buildBalanceTimeline(10_000, [
        trade("2026-01-01T00:00:00Z", 1_000),
        trade("2026-01-02T00:00:00Z", -400),
        trade("2026-01-03T00:00:00Z", -300),
        trade("2026-01-04T00:00:00Z", 900),
      ]),
    );
    expect(series.map((p) => p.ddMoney)).toEqual([0, 0, -400, -700, 0]);
  });

  it("agrees with computeDrawdown about the trough", () => {
    const tl = buildBalanceTimeline(10_000, [
      trade("2026-01-01T00:00:00Z", 1_000),
      trade("2026-01-02T00:00:00Z", -400),
      trade("2026-01-03T00:00:00Z", -300),
    ]);
    const series = drawdownSeries(tl);
    const worst = series.reduce((a, b) => (b.ddMoney < a.ddMoney ? b : a));
    expect(worst.ddMoney).toBe(computeDrawdown(tl).maxMoney);
    expect(worst.at).toBe(computeDrawdown(tl).maxAt);
  });

  it("keeps the percentage series negative-or-zero", () => {
    const series = drawdownSeries(
      buildBalanceTimeline(
        10_000,
        [trade("2026-01-03T00:00:00Z", -500)],
        [cash("2026-01-02T00:00:00Z", 5_000)],
      ),
    );
    expect(series.every((p) => p.ddPct <= 0)).toBe(true);
  });

  it("does not report a withdrawal as a drawdown", () => {
    // Money left the account; nothing was lost. The chart must agree with the
    // KPI, which measures the drop in cumulative P&L, not in equity.
    const tl = buildBalanceTimeline(
      10_000,
      [trade("2026-01-01T00:00:00Z", 500)],
      [cash("2026-01-05T00:00:00Z", -5_000, "withdrawal")],
    );
    const series = drawdownSeries(tl);
    expect(series.every((p) => p.ddMoney === 0)).toBe(true);
    expect(series.every((p) => p.ddPct === 0)).toBe(true);
    expect(computeDrawdown(tl).maxPctOfEquity).toBe(0);
  });

  it("uses the same numerator and denominator as computeDrawdown", () => {
    const tl = buildBalanceTimeline(
      10_000,
      [
        trade("2026-01-01T00:00:00Z", 1_000),
        trade("2026-01-03T00:00:00Z", -700),
      ],
      [cash("2026-01-02T00:00:00Z", 5_000)],
    );
    const stats = computeDrawdown(tl);
    const worst = drawdownSeries(tl).reduce((a, b) =>
      b.ddMoney < a.ddMoney ? b : a,
    );
    expect(Math.abs(worst.ddPct)).toBeCloseTo(stats.maxPctOfEquity!, 10);
  });
});

describe("netCashFlow", () => {
  it("nets deposits against withdrawals", () => {
    expect(
      netCashFlow([
        cash("2026-01-01T00:00:00Z", 5_000),
        cash("2026-02-01T00:00:00Z", -1_500),
      ]),
    ).toBe(3_500);
  });
});

describe("resolvePeriodWindow", () => {
  const events: CashEvent[] = [
    {
      id: "c1",
      account_id: "a",
      event_type: "deposit",
      amount: 5_000,
      occurred_at: "2026-01-10T00:00:00Z",
      note: null,
    },
    {
      id: "c2",
      account_id: "a",
      event_type: "withdrawal",
      amount: -1_000,
      occurred_at: "2026-03-10T00:00:00Z",
      note: null,
    },
  ];
  const trades = [
    { at: "2026-01-15T00:00:00Z", pnl: 2_000 },
    { at: "2026-03-15T00:00:00Z", pnl: -500 },
  ];
  const cutoff = new Date("2026-02-01T00:00:00Z").getTime();

  it("passes everything through for an all-time window", () => {
    const w = resolvePeriodWindow(10_000, trades, events, null);
    expect(w.openingEquity).toBe(10_000);
    expect(w.events).toHaveLength(2);
    expect(w.priorPnl).toBe(0);
  });

  it("opens at the equity the account actually held at the cutoff", () => {
    const w = resolvePeriodWindow(10_000, trades, events, cutoff);
    // 10,000 start + 5,000 deposit + 2,000 P&L, all before February.
    expect(w.openingEquity).toBe(17_000);
    expect(w.priorPnl).toBe(2_000);
  });

  it("keeps only cash events inside the window", () => {
    const w = resolvePeriodWindow(10_000, trades, events, cutoff);
    expect(w.events.map((e) => e.id)).toEqual(["c2"]);
  });

  it("does not let an out-of-window deposit inflate peak equity", () => {
    // The bug: trades were windowed but cash events were not, so the January
    // deposit landed in a February-onward curve that started at the raw opening
    // balance — inflating peak equity and shrinking every drawdown percentage.
    const w = resolvePeriodWindow(10_000, trades, events, cutoff);
    const windowed = computeDrawdown(
      buildBalanceTimeline(
        w.openingEquity,
        trades.filter((t) => new Date(t.at).getTime() >= cutoff),
        w.events,
      ),
    );

    const broken = computeDrawdown(
      buildBalanceTimeline(
        10_000,
        trades.filter((t) => new Date(t.at).getTime() >= cutoff),
        events,
      ),
    );

    expect(windowed.maxMoney).toBe(-500);
    expect(broken.maxMoney).toBe(-500);
    // Same dollar drawdown, different denominator: 500/17,000 vs 500/15,000.
    expect(windowed.maxPctOfEquity).toBeCloseTo((500 / 17_000) * 100, 6);
    expect(broken.maxPctOfEquity).toBeCloseTo((500 / 15_000) * 100, 6);
    expect(windowed.maxPctOfEquity!).not.toBeCloseTo(broken.maxPctOfEquity!, 6);
  });
});

describe("timeline ordering across timestamp formats", () => {
  it("orders mixed +00:00 and .000Z timestamps by instant", () => {
    // A text sort puts "+00:00" before ".000Z" at an equal whole second, and
    // more importantly cannot order these two correctly at all.
    const tl = buildBalanceTimeline(0, [
      { at: "2026-01-02T10:00:00.000Z", pnl: 50 },
      { at: "2026-01-01T10:00:00+00:00", pnl: 100 },
    ]);
    expect(tl.map((p) => p.realizedPnl)).toEqual([0, 100, 150]);
  });

  it("keeps a same-instant cash event ahead of the trade regardless of format", () => {
    const tl = buildBalanceTimeline(
      1_000,
      [{ at: "2026-01-01T10:00:00+00:00", pnl: -100 }],
      [
        {
          id: "c",
          account_id: "a",
          event_type: "deposit",
          amount: 500,
          occurred_at: "2026-01-01T10:00:00.000Z",
          note: null,
        },
      ],
    );
    expect(tl.map((p) => p.kind)).toEqual(["start", "cash", "trade"]);
    expect(tl[tl.length - 1].equity).toBe(1_400);
  });
});

describe("computeDrawdown and drawdownSeries agree", () => {
  // Both now walk one shared peak-tracking helper. This pins the invariant that
  // made sharing safe: the deepest point of the plotted curve is the same
  // number the KPI reports, so the chart can never contradict the headline.
  const timeline = buildBalanceTimeline(
    10_000,
    [
      { at: "2026-01-01T00:00:00Z", pnl: 500 },
      { at: "2026-01-02T00:00:00Z", pnl: -300 },
      { at: "2026-01-03T00:00:00Z", pnl: -400 },
      { at: "2026-01-04T00:00:00Z", pnl: 900 },
      { at: "2026-01-05T00:00:00Z", pnl: -250 },
    ],
    [
      {
        id: "d",
        account_id: "a",
        event_type: "deposit",
        amount: 2_000,
        occurred_at: "2026-01-02T12:00:00Z",
        note: null,
      },
    ],
  );

  it("reports the same worst drop in money", () => {
    const stats = computeDrawdown(timeline);
    const series = drawdownSeries(timeline);
    const worstPlotted = Math.min(...series.map((p) => p.ddMoney));
    expect(stats.maxMoney).toBe(worstPlotted);
    expect(stats.maxMoney).toBe(-700);
  });

  it("puts the trough at the same point in time", () => {
    const stats = computeDrawdown(timeline);
    const series = drawdownSeries(timeline);
    const trough = series.reduce((a, b) => (b.ddMoney < a.ddMoney ? b : a));
    expect(stats.maxAt).toBe(trough.at);
  });

  it("ends at the same current drawdown", () => {
    const stats = computeDrawdown(timeline);
    const series = drawdownSeries(timeline);
    expect(stats.currentMoney).toBe(series[series.length - 1].ddMoney);
  });
});

describe("drawdownEpisodes — how long, not only how deep", () => {
  /** A book that falls, climbs back, and falls again without recovering. */
  const twoFalls = () =>
    buildBalanceTimeline(
      10_000,
      [
        { at: "2026-01-05T12:00:00Z", pnl: 1_000 }, // peak
        { at: "2026-01-07T12:00:00Z", pnl: -400 },
        { at: "2026-01-09T12:00:00Z", pnl: -300 }, // trough of the first fall
        { at: "2026-01-16T12:00:00Z", pnl: 800 }, // back above the peak
        { at: "2026-01-20T12:00:00Z", pnl: -600 }, // second fall, never recovered
      ],
      [],
    );

  it("closes an episode on the peak that ends it, and dates the climb back", () => {
    const [first] = drawdownEpisodes(twoFalls(), "UTC");
    expect(first.startAt).toBe("2026-01-05T12:00:00Z");
    expect(first.troughAt).toBe("2026-01-09T12:00:00Z");
    expect(first.recoveredAt).toBe("2026-01-16T12:00:00Z");
    expect(first.depthMoney).toBe(-700);
    // 5 Jan to 16 Jan under water, and 9 Jan to 16 Jan climbing out.
    expect(first.days).toBe(11);
    expect(first.daysToRecover).toBe(7);
  });

  it("leaves the last episode open when the book never got back", () => {
    const episodes = drawdownEpisodes(twoFalls(), "UTC");
    expect(episodes).toHaveLength(2);
    const last = episodes[1];
    expect(last.recoveredAt).toBeNull();
    expect(last.daysToRecover).toBeNull();
    expect(last.depthMoney).toBe(-600);
  });

  it("does not merge two falls across a new peak", () => {
    const depths = drawdownEpisodes(twoFalls(), "UTC").map((e) => e.depthMoney);
    expect(depths).toEqual([-700, -600]);
  });

  it("counts days on the account's clock, not in elapsed hours", () => {
    // 23:00 in New York on the 5th is already the 6th in UTC: the same two
    // instants are one day apart on one clock and two on the other.
    const tl = buildBalanceTimeline(
      1_000,
      [
        { at: "2026-01-06T04:00:00Z", pnl: 100 },
        { at: "2026-01-07T04:00:00Z", pnl: -50 },
        { at: "2026-01-08T04:00:00Z", pnl: 80 },
      ],
      [],
    );
    const ny = drawdownEpisodes(tl, "America/New_York")[0];
    const utc = drawdownEpisodes(tl, "UTC")[0];
    expect(ny.days).toBe(utc.days);
    expect(ny.startAt).toBe(utc.startAt);
  });

  it("counts no days when an instant cannot be read as a date", () => {
    // `buildBalanceTimeline` keeps a point whose `at` is unparseable (the
    // reports engine feeds it synthetic keys); the duration of such an episode
    // is unknown, and 0 is the honest answer rather than a guess.
    const tl = buildBalanceTimeline(
      1_000,
      [
        { at: "2026-01-05T12:00:00Z", pnl: 100 },
        { at: "not-a-date", pnl: -50 },
      ],
      [],
    );
    const [episode] = drawdownEpisodes(tl, "UTC");
    expect(episode.days).toBe(0);
  });

  it("has nothing to report on a book that only ever rose", () => {
    const tl = buildBalanceTimeline(1_000, [{ at: "2026-01-05T12:00:00Z", pnl: 500 }], []);
    expect(drawdownEpisodes(tl, "UTC")).toEqual([]);
  });
});

describe("drawdownDuration", () => {
  const episodes = [
    { startAt: "a", troughAt: "b", recoveredAt: "c", depthMoney: -700, days: 11, daysToRecover: 7 },
    { startAt: "d", troughAt: "e", recoveredAt: null, depthMoney: -900, days: 4, daysToRecover: null },
  ];

  it("reports the longest stretch, the open one, and the climb out of the worst", () => {
    const d = drawdownDuration(episodes);
    expect(d.longestDays).toBe(11);
    expect(d.currentDays).toBe(4);
    // The deepest episode is the one still open, so its climb has not happened.
    expect(d.daysToRecoverWorst).toBeNull();
    expect(d.episodes).toBe(2);
  });

  it("says zero days under water when the book sits at a peak", () => {
    const d = drawdownDuration([episodes[0]]);
    expect(d.currentDays).toBe(0);
    expect(d.daysToRecoverWorst).toBe(7);
  });

  it("answers an empty book without inventing an episode", () => {
    expect(drawdownDuration([])).toEqual({
      longestDays: 0,
      currentDays: 0,
      daysToRecoverWorst: null,
      episodes: 0,
    });
  });
});

describe("a fall with no peak equity to divide by", () => {
  it("answers null rather than the 0 % that reads as flawless", () => {
    // The same hole `maxPctOfPeakPnl` had, on the equity base: a book with no
    // starting balance that only ever lost has a real fall and no denominator.
    // As 0 it scored a perfect 100 on the survival axis — six straight losses
    // rendered as flawless risk management.
    const tl = buildBalanceTimeline(0, [
      { at: "2026-01-02T12:00:00Z", pnl: -100 },
      { at: "2026-01-03T12:00:00Z", pnl: -200 },
    ]);
    const stats = computeDrawdown(tl);
    expect(stats.maxMoney).toBe(-300);
    expect(stats.maxPctOfEquity).toBeNull();
    expect(stats.maxPctOfPeakPnl).toBeNull();
  });

  it("keeps 0 for a book that genuinely never fell", () => {
    // The distinction the null exists to make, in its positive direction.
    const tl = buildBalanceTimeline(10_000, [
      { at: "2026-01-02T12:00:00Z", pnl: 100 },
      { at: "2026-01-03T12:00:00Z", pnl: 200 },
    ]);
    expect(computeDrawdown(tl).maxPctOfEquity).toBe(0);
  });
});
