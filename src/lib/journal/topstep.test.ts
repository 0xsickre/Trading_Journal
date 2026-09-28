import { describe, expect, it } from "vitest";
import {
  TOPSTEP_PLANS,
  evaluateTopstep,
  topstepTradingDay,
  type TopstepConfig,
  type TopstepResult,
  type TopstepTrade,
} from "./topstep";

const cfg = (over: Partial<TopstepConfig> = {}): TopstepConfig => ({
  enabled: true,
  plan: "50K",
  startingBalance: 50_000,
  payoutAt: null,
  resetAt: null,
  ...over,
});
const t = (closedAt: string, net: number): TopstepTrade => ({ closedAt, net });
// 15:00 UTC is 10:00 in Chicago in September — the middle of a trading day.
const run = (trades: TopstepTrade[], over: Partial<TopstepConfig> = {}, now = "2026-09-30T15:00:00Z") =>
  evaluateTopstep(cfg(over), trades, now) as TopstepResult;

describe("the plans are Topstep's own numbers", () => {
  it("50K / 100K / 150K", () => {
    expect(TOPSTEP_PLANS["50K"]).toMatchObject({ mll: 2000, dll: 1000, target: 3000, maxMini: 5 });
    expect(TOPSTEP_PLANS["100K"]).toMatchObject({ mll: 3000, dll: 2000, target: 6000, maxMini: 10 });
    expect(TOPSTEP_PLANS["150K"]).toMatchObject({ mll: 4500, dll: 3000, target: 9000, maxMini: 15 });
  });

  it("three stops at the most a trade may risk still fit inside the DLL", () => {
    for (const p of Object.values(TOPSTEP_PLANS)) expect(3 * p.riskMax).toBeLessThanOrEqual(p.dll);
  });
});

describe("the trading day is Chicago's, 17:00 to 17:00", () => {
  it("a fill after 17:00 CT belongs to the next day", () => {
    expect(topstepTradingDay("2026-09-28T21:59:00Z")).toBe("2026-09-28"); // 16:59 CT
    expect(topstepTradingDay("2026-09-28T22:30:00Z")).toBe("2026-09-29"); // 17:30 CT
  });

  it("the Sunday open is Monday's session", () => {
    expect(topstepTradingDay("2026-09-27T23:00:00Z")).toBe("2026-09-28"); // Sun 18:00 CT
  });
});

describe("the Maximum Loss Limit", () => {
  it("starts at the starting balance minus the plan's MLL", () => {
    const r = run([]);
    expect(r.mllFloor).toBe(48_000);
    expect(r.room).toBe(2_000);
    expect(r.status).toBe("active");
  });

  it("rises only with the END-OF-DAY balance, not the intraday high", () => {
    // Up 1 500 at noon, gives back 1 000 by the close: the floor follows the close.
    const r = run([t("2026-09-28T15:00:00Z", 1500), t("2026-09-28T18:00:00Z", -1000)]);
    expect(r.balance).toBe(50_500);
    expect(r.mllFloor).toBe(48_500);
  });

  it("today's win does not raise the floor before the day ends", () => {
    // Up 1 000 this morning: the floor is still yesterday's, so the room is 3 000,
    // not 2 000 — the afternoon is sized from what Topstep will actually allow.
    const r = run([t("2026-09-30T14:00:00Z", 1000)]);
    expect(r.mllFloor).toBe(48_000);
    expect(r.room).toBe(3_000);
    // The next morning it has: the day closed at 51 000.
    expect(run([t("2026-09-30T14:00:00Z", 1000)], {}, "2026-10-01T15:00:00Z").mllFloor).toBe(49_000);
  });

  it("never comes down after a losing day", () => {
    const r = run([t("2026-09-28T15:00:00Z", 1000), t("2026-09-29T15:00:00Z", -800)]);
    expect(r.mllFloor).toBe(49_000);
    expect(r.room).toBe(1_200); // 50 200 − 49 000
  });

  it("locks at the starting balance and stays there", () => {
    const r = run([t("2026-09-28T15:00:00Z", 2000), t("2026-09-29T15:00:00Z", 3000)]);
    expect(r.mllFloor).toBe(50_000);
    expect(r.mllLocked).toBe(true);
    expect(r.room).toBe(5_000);
  });

  it("a realized balance on the floor ends the account", () => {
    const r = run([t("2026-09-28T15:00:00Z", -2000)]);
    expect(r.status).toBe("failed");
    expect(r.mllBreachDay).toBe("2026-09-28");
  });

  it("after the first payout the floor is the starting balance", () => {
    const r = run([t("2026-09-28T15:00:00Z", 1000)], { payoutAt: "2026-09-29T12:00:00Z" });
    expect(r.mllFloor).toBe(50_000);
    expect(r.room).toBe(1_000);
  });

  it("scales with the plan: 150K has a 4 500 MLL", () => {
    const r = run([], { plan: "150K", startingBalance: 150_000 });
    expect(r.mllFloor).toBe(145_500);
    expect(r.room).toBe(4_500);
  });
});

describe("the Daily Loss Limit ends the day, not the account", () => {
  it("a day that lost the DLL is recorded and the account lives", () => {
    const r = run([t("2026-09-28T15:00:00Z", -1000)], { plan: "100K", startingBalance: 100_000 });
    expect(r.dllDays).toEqual([]); // 100K's DLL is 2 000
    const r50 = run([t("2026-09-28T15:00:00Z", -1000)]);
    expect(r50.dllDays).toEqual(["2026-09-28"]);
    expect(r50.status).toBe("active");
  });

  it("what is left today counts today's net, gains included", () => {
    const now = "2026-09-30T18:00:00Z";
    expect(run([t("2026-09-30T15:00:00Z", -400)], {}, now).dllLeftToday).toBe(600);
    expect(run([t("2026-09-30T15:00:00Z", 500)], {}, now).dllLeftToday).toBe(1500);
    expect(run([t("2026-09-29T15:00:00Z", -400)], {}, now).dllLeftToday).toBe(1000); // yesterday
  });
});

describe("consistency and the target", () => {
  it("passes at the target when no day was bigger than 55 % of it", () => {
    const r = run([t("2026-09-28T15:00:00Z", 1600), t("2026-09-29T15:00:00Z", 1400)]);
    expect(r.consistencyOk).toBe(true);
    expect(r.status).toBe("passed");
  });

  it("a day above 1 650 on 50K raises the target to that day ÷ 0.55", () => {
    const r = run([t("2026-09-28T15:00:00Z", 2200), t("2026-09-29T15:00:00Z", 900)]);
    expect(r.consistencyOk).toBe(false);
    expect(r.effectiveTarget).toBeCloseTo(4000, 6);
    expect(r.status).toBe("active"); // 3 100 is not 4 000
  });
});

describe("off and reset", () => {
  it("is off when the account is not in Topstep mode", () => {
    expect(evaluateTopstep(cfg({ enabled: false }), []).status).toBe("off");
  });

  it("a reset starts the account again: earlier trades do not count", () => {
    const r = run([t("2026-09-28T15:00:00Z", -1500), t("2026-09-29T15:00:00Z", 200)], {
      resetAt: "2026-09-29T00:00:00Z",
    });
    expect(r.balance).toBe(50_200);
    expect(r.daysTraded).toBe(1);
  });
});

describe("reading an account", () => {
  it("takes the plan, balance, payout and reset off the account row", async () => {
    const { topstepConfigFromAccount } = await import("./topstep");
    const c = topstepConfigFromAccount({
      topstep_mode: true,
      topstep_plan: "150K",
      starting_balance: 150_000,
      topstep_payout_at: null,
      topstep_reset_at: "2026-09-01T00:00:00Z",
    } as never);
    expect(c).toEqual({ enabled: true, plan: "150K", startingBalance: 150_000, payoutAt: null, resetAt: "2026-09-01T00:00:00Z" });
  });

  it("a trade closed after the payout already stands on the starting balance as its floor", () => {
    const r = run([t("2026-09-28T15:00:00Z", 1000), t("2026-09-29T15:00:00Z", -1200)], { payoutAt: "2026-09-29T12:00:00Z" });
    expect(r.mllFloor).toBe(50_000);
    expect(r.status).toBe("failed"); // 49 800 is under the 50 000 floor
  });
});
