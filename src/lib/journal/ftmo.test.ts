import { describe, expect, it } from "vitest";
import {
  evaluateFtmo,
  ftmoConfigFromAccount,
  type FtmoConfig,
  type FtmoTrade,
} from "./ftmo";

const baseConfig = (over: Partial<FtmoConfig> = {}): FtmoConfig => ({
  enabled: true,
  startingBalance: 100_000,
  timezone: "UTC",
  dailyLoss: { enabled: true, pct: 5, basis: "starting_balance" }, // -5000/day
  maxLoss: { enabled: true, pct: 10 }, // floor 90_000
  profitTarget: { enabled: true, pct: 10 }, // +10_000
  minDays: { enabled: true, days: 2 },
  resetAt: null,
  ...over,
});

const t = (closedAt: string, net: number): FtmoTrade => ({ closedAt, net });

describe("evaluateFtmo", () => {
  it("returns off when mode disabled", () => {
    const r = evaluateFtmo(baseConfig({ enabled: false }), [t("2026-07-01T12:00:00Z", -9999)]);
    expect(r.status).toBe("off");
  });

  it("stays active within limits", () => {
    const r = evaluateFtmo(baseConfig(), [
      t("2026-07-01T12:00:00Z", 500),
      t("2026-07-02T12:00:00Z", -300),
    ]);
    expect(r.status).toBe("active");
    expect(r.breaches).toHaveLength(0);
    expect(r.daysTraded).toBe(2);
  });

  it("fails on daily loss breach", () => {
    const r = evaluateFtmo(baseConfig(), [
      t("2026-07-01T09:00:00Z", -3000),
      t("2026-07-01T15:00:00Z", -2500), // day total -5500 <= -5000
    ]);
    expect(r.status).toBe("failed");
    expect(r.breaches[0].rule).toBe("daily_loss");
    expect(r.breaches[0].date).toBe("2026-07-01");
  });

  it("fails on static max loss breach", () => {
    const r = evaluateFtmo(
      baseConfig({ dailyLoss: { enabled: false, pct: 5, basis: "starting_balance" } }),
      [
        t("2026-07-01T12:00:00Z", -4000),
        t("2026-07-02T12:00:00Z", -4000),
        t("2026-07-03T12:00:00Z", -3000), // equity 89_000 <= 90_000 floor
      ],
    );
    expect(r.status).toBe("failed");
    expect(r.breaches.some((b) => b.rule === "max_loss")).toBe(true);
  });

  it("passes when target and min days met", () => {
    const r = evaluateFtmo(baseConfig(), [
      t("2026-07-01T12:00:00Z", 6000),
      t("2026-07-02T12:00:00Z", 5000), // +11_000 >= 10_000, 2 days
    ]);
    expect(r.status).toBe("passed");
    expect(r.targetReached).toBe(true);
    expect(r.minDaysMet).toBe(true);
  });

  it("target reached but not enough days stays active", () => {
    const r = evaluateFtmo(baseConfig(), [t("2026-07-01T12:00:00Z", 12000)]);
    expect(r.targetReached).toBe(true);
    expect(r.minDaysMet).toBe(false);
    expect(r.status).toBe("active");
  });

  it("failure takes priority over reaching target", () => {
    const r = evaluateFtmo(baseConfig({ minDays: { enabled: false, days: 0 } }), [
      t("2026-07-01T12:00:00Z", 12000), // hits target
      t("2026-07-02T12:00:00Z", -6000), // but daily loss breach
    ]);
    expect(r.status).toBe("failed");
  });

  it("prev_close basis widens the daily limit after a profitable day", () => {
    // Day 1: +10_000 → equity 110_000. Day 2 loses 5_400.
    // starting_balance basis: limit is always -5% of 100_000 = -5_000 → breach.
    // prev_close basis: day 2's limit is -5% of 110_000 = -5_500 → no breach.
    const trades = [
      t("2026-07-01T12:00:00Z", 10_000),
      t("2026-07-02T12:00:00Z", -5_400),
    ];

    const staticResult = evaluateFtmo(baseConfig(), trades);
    expect(staticResult.status).toBe("failed");
    expect(staticResult.breaches.some((b) => b.rule === "daily_loss")).toBe(true);

    const rollingResult = evaluateFtmo(
      baseConfig({ dailyLoss: { enabled: true, pct: 5, basis: "prev_close" } }),
      trades,
    );
    expect(rollingResult.breaches.some((b) => b.rule === "daily_loss")).toBe(
      false,
    );
    // The live limit reported is for the day AFTER the last one traded,
    // based on the latest close (100_000 + 10_000 - 5_400 = 104_600).
    expect(rollingResult.dailyLossLimit).toBeCloseTo(-(104_600 * 0.05), 6);
  });

  it("ignores trades before resetAt", () => {
    const r = evaluateFtmo(baseConfig({ resetAt: "2026-07-02T00:00:00Z" }), [
      t("2026-07-01T12:00:00Z", -9000), // pre-reset, ignored
      t("2026-07-02T12:00:00Z", 200),
    ]);
    expect(r.status).toBe("active");
    expect(r.daysTraded).toBe(1);
    expect(r.netPnl).toBe(200);
  });
});

describe("headroom — how close the account came to being finished", () => {
  /**
   * THE CLOSEST APPROACH, NOT THE ROOM LEFT TODAY, and the difference is the
   * whole reason the field exists. An account up 8 % that once sat at 4.5 %
   * against a 5 % floor was one bad day from the end of its challenge. A
   * "what can I still lose right now" reading scores that 100 the morning
   * after, which is exactly the fact the Sickre Score had no way to see.
   */
  const room = (trades: FtmoTrade[], over: Partial<FtmoConfig> = {}) =>
    evaluateFtmo(baseConfig(over), trades).headroomPct;

  it("is null, never 100, for a challenge with nothing closed in its window", () => {
    // THE S1 DEFECT, ONE MODULE UPSTREAM. A fresh challenge has approached no
    // limit because it has done nothing, and scoring that as perfect risk
    // management is a maximum awarded for never having taken a risk. Null, so
    // `computeSickreScore` drops the component and renormalizes.
    expect(room([])).toBeNull();
    // Same for a window emptied by a reset: the trades exist, the challenge
    // has not seen them.
    expect(
      room([t("2026-07-01T12:00:00Z", -4000)], {
        resetAt: "2026-07-02T00:00:00Z",
      }),
    ).toBeNull();
  });

  it("is null when neither loss rule is enabled", () => {
    // Nothing to be close to. Not 100 — there is no limit to have room against.
    expect(
      room([t("2026-07-01T12:00:00Z", -4000)], {
        dailyLoss: { enabled: false, pct: 5, basis: "starting_balance" },
        maxLoss: { enabled: false, pct: 10 },
      }),
    ).toBeNull();
  });

  it("reports the room left by the worse of the two rules", () => {
    // -2500 in a day: half the 5000 daily allowance → 50 % daily room. Total
    // drawdown 2.5 % of a 10 % floor → 75 % room there. The daily rule came
    // nearer, so it decides. Max, not average: averaging lets a comfortable
    // total drawdown paper over a day that nearly ended the challenge.
    expect(room([t("2026-07-01T12:00:00Z", -2500)])).toBeCloseTo(50, 6);
  });

  it("scores the reported shape: 4.5 % against a 5 % floor leaves 10 %", () => {
    // The example the component was added for — profitable overall, and one
    // bad day from the end.
    const trades = [
      t("2026-07-01T12:00:00Z", -4500), // 4.5 % of the starting balance
      t("2026-07-02T12:00:00Z", 12_500), // finishes up 8 %
    ];
    const r = evaluateFtmo(
      baseConfig({
        dailyLoss: { enabled: false, pct: 5, basis: "starting_balance" },
        maxLoss: { enabled: true, pct: 5 },
      }),
      trades,
    );
    expect(r.profitPct).toBeCloseTo(8, 6);
    expect(r.headroomPct).toBeCloseTo(10, 6);
  });

  it("is zero once a limit is touched or breached, not negative", () => {
    const touched = room([t("2026-07-01T12:00:00Z", -5000)]); // exactly the daily limit
    expect(touched).toBe(0);
    const blown = evaluateFtmo(baseConfig(), [
      t("2026-07-01T09:00:00Z", -8000),
    ]);
    expect(blown.status).toBe("failed");
    expect(blown.headroomPct).toBe(0);
  });

  it("counts a winning day as using none of its allowance, not as no data", () => {
    // Only the daily rule is on, and no day lost anything. That is full room,
    // measured — distinct from the empty window above, which is no room known.
    expect(
      room([t("2026-07-01T12:00:00Z", 900)], {
        maxLoss: { enabled: false, pct: 10 },
      }),
    ).toBe(100);
  });

  it("measures each day against THAT day's allowance on the rolling basis", () => {
    // The reason this is computed inside the day loop instead of afterwards
    // from `dailyLossLimit`, which only carries the allowance in force for the
    // day after the last one traded.
    //
    // Day 1 wins 20_000, so day 2 opens at 120_000 and its 5 % allowance is
    // 6000. Losing 3000 that day uses half of it → 50 % room. Dividing by the
    // last limit (5 % of 117_000 = 5850) would have said 48.7 %, measuring the
    // day against an allowance it never had.
    const trades = [
      t("2026-07-01T12:00:00Z", 20_000),
      t("2026-07-02T12:00:00Z", -3000),
    ];
    expect(
      room(trades, {
        dailyLoss: { enabled: true, pct: 5, basis: "prev_close" },
        maxLoss: { enabled: false, pct: 10 },
        profitTarget: { enabled: false, pct: 10 },
      }),
    ).toBeCloseTo(50, 6);

    // The same trades on the static basis measure day 2 against 5 % of the
    // ORIGINAL 100_000, so 3000 of 5000 → 40 % room. Stricter, as it should be.
    expect(
      room(trades, {
        maxLoss: { enabled: false, pct: 10 },
        profitTarget: { enabled: false, pct: 10 },
      }),
    ).toBeCloseTo(40, 6);
  });

  it("is null on the off result, like every other figure there", () => {
    expect(evaluateFtmo(baseConfig({ enabled: false }), []).headroomPct).toBeNull();
  });
});

describe("instant comparison at the reset boundary", () => {
  // PostgREST hands back "+00:00"; resetFtmoChallenge writes ".000Z". Compared
  // as text these invert at an identical whole second, because '+' (0x2B) sorts
  // before '.' (0x2E) — so a trade closed AFTER the reset was read as before it
  // and silently excluded from the challenge window.
  const postgrest = "2026-07-28T10:00:00+00:00"; // the instant of the reset
  const appWritten = "2026-07-28T10:00:00.000Z"; // the same instant, app format

  it("demonstrates the text comparison these formats used to rely on", () => {
    expect(postgrest >= appWritten).toBe(false); // the bug: same instant, reads as earlier
  });

  const cfg = {
    enabled: true,
    startingBalance: 100_000,
    timezone: "America/New_York",
    dailyLoss: { enabled: false, pct: 5, basis: "starting_balance" as const },
    maxLoss: { enabled: false, pct: 10 },
    profitTarget: { enabled: false, pct: 10 },
    minDays: { enabled: false, days: 4 },
    resetAt: appWritten,
  };

  it("counts a trade closed exactly at the reset instant", () => {
    const r = evaluateFtmo(cfg, [{ closedAt: postgrest, net: 250 }]);
    expect(r.netPnl).toBe(250);
    expect(r.daysTraded).toBe(1);
  });

  it("still excludes a trade closed a second before the reset", () => {
    const r = evaluateFtmo(cfg, [
      { closedAt: "2026-07-28T09:59:59+00:00", net: 250 },
    ]);
    expect(r.netPnl).toBe(0);
    expect(r.daysTraded).toBe(0);
  });

  it("orders mixed-format timestamps chronologically", () => {
    // Wrong ordering would misattribute which day breached first.
    const r = evaluateFtmo(
      { ...cfg, resetAt: null, dailyLoss: { enabled: true, pct: 1, basis: "starting_balance" as const } },
      [
        { closedAt: "2026-07-28T20:00:00.000Z", net: -600 },
        { closedAt: "2026-07-28T14:00:00+00:00", net: -600 },
      ],
    );
    // Both land on the same NY day: -1200 breaches the -1000 daily limit.
    expect(r.status).toBe("failed");
    expect(r.breaches[0].amount).toBe(-1200);
  });
});

describe("ftmoConfigFromAccount", () => {
  const account = {
    id: "acc",
    name: "Challenge",
    broker: null,
    account_kind: "trading" as const,
    currency: "USD",
    starting_balance: 200_000,
    default_asset_class: null,
    timezone: "Europe/Belgrade",
    is_active: true,
    breakeven_from: 0,
    breakeven_to: 0,
    breakeven_unit: "currency" as const,
    default_commission_per_unit: 0,
    default_fee_fixed: 0,
    default_swap_per_day: 0,
    default_stop_pct: null,
    default_target_pct: null,
    ftmo_mode: true,
    ftmo_daily_loss_enabled: true,
    ftmo_daily_loss_pct: 4,
    ftmo_daily_loss_basis: "prev_close" as const,
    ftmo_max_loss_enabled: false,
    ftmo_max_loss_pct: 8,
    ftmo_profit_target_enabled: true,
    ftmo_profit_target_pct: 9,
    ftmo_min_days_enabled: false,
    ftmo_min_days: 3,
    ftmo_reset_at: "2026-07-01T00:00:00Z",
    archived_at: null,
    created_at: "2026-01-01T00:00:00Z",
  };

  it("carries every limit across from the account row", () => {
    // Nine numbers and five switches, flat on the row and nested in the config.
    // A pair transposed here — max loss read into the daily limit — fails the
    // challenge on the dashboard while the real account is fine, and nothing
    // downstream can tell, because both values are plausible percentages.
    expect(ftmoConfigFromAccount(account)).toEqual({
      enabled: true,
      startingBalance: 200_000,
      timezone: "Europe/Belgrade",
      dailyLoss: { enabled: true, pct: 4, basis: "prev_close" },
      maxLoss: { enabled: false, pct: 8 },
      profitTarget: { enabled: true, pct: 9 },
      minDays: { enabled: false, days: 3 },
      resetAt: "2026-07-01T00:00:00Z",
    });
  });

  it("produces a config the evaluator reads as off when the account is not in challenge mode", () => {
    const off = ftmoConfigFromAccount({ ...account, ftmo_mode: false });
    expect(evaluateFtmo(off, [t("2026-07-02T12:00:00Z", -50_000)]).status).toBe("off");
  });
});
