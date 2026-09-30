import { describe, expect, it } from "vitest";
import {
  TOPSTEP_PLANS,
  evaluateTopstep,
  riskBudgetAt,
  topstepMinRiskFromRoom,
  topstepScalingMaxMini,
  topstepStateAt,
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
  personalDll: null,
  dailyTarget: null,
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

  it("a reset clears a reached MLL — what lets a new plan through again", () => {
    const blown = [t("2026-09-28T15:00:00Z", -2_100)];
    expect(run(blown).status).toBe("failed");
    const after = run(blown, { resetAt: "2026-09-29T00:00:00Z" });
    expect(after.status).toBe("active");
    expect(after.mllBreachDay).toBeNull();
  });
});

describe("reading an account", () => {
  it("takes the plan, balance, payout, reset and personal limits off the account row", async () => {
    const { topstepConfigFromAccount } = await import("./topstep");
    const c = topstepConfigFromAccount({
      topstep_mode: true,
      topstep_plan: "150K",
      starting_balance: 150_000,
      topstep_payout_at: null,
      topstep_reset_at: "2026-09-01T00:00:00Z",
      topstep_personal_dll: 2_000,
      topstep_daily_target: null,
      topstep_stage: "combine",
    } as never);
    expect(c).toEqual({
      enabled: true,
      plan: "150K",
      startingBalance: 150_000,
      payoutAt: null,
      resetAt: "2026-09-01T00:00:00Z",
      personalDll: 2_000,
      dailyTarget: null,
      stage: "combine",
      payouts: [],
    });
  });

  it("a trade closed after the payout already stands on the starting balance as its floor", () => {
    const r = run([t("2026-09-28T15:00:00Z", 1000), t("2026-09-29T15:00:00Z", -1200)], { payoutAt: "2026-09-29T12:00:00Z" });
    expect(r.mllFloor).toBe(50_000);
    expect(r.status).toBe("failed"); // 49 800 is under the 50 000 floor
  });
});

describe("the account as it stood at a moment (F3)", () => {
  // Mon 28.09 closes +1 000; Tue 29.09 loses 400 at 09:00 CT and 300 at 11:00 CT.
  const book = [
    t("2026-09-28T15:00:00Z", 1_000),
    t("2026-09-29T14:00:00Z", -400),
    t("2026-09-29T16:00:00Z", -300),
  ];

  it("before anything: the whole MLL is room, the whole DLL is left", () => {
    const s = topstepStateAt(cfg(), book, "2026-09-28T13:00:00Z")!;
    expect(s.room).toBe(2_000);
    expect(s.dllLeftToday).toBe(1_000);
  });

  it("Tuesday 10:00 CT: Monday's close raised the floor, the morning loss used DLL", () => {
    const s = topstepStateAt(cfg(), book, "2026-09-29T15:00:00Z")!;
    // Floor 49 000 after Monday's EOD of 51 000; balance 50 600.
    expect(s.mllFloor).toBe(49_000);
    expect(s.balance).toBe(50_600);
    expect(s.room).toBe(1_600);
    expect(s.dllLeftToday).toBe(600);
  });

  it("counts only what had CLOSED before the moment", () => {
    // A trade closing at the very instant is not yet in the state.
    const s = topstepStateAt(cfg(), book, "2026-09-29T14:00:00Z")!;
    expect(s.balance).toBe(51_000);
    expect(s.dllLeftToday).toBe(1_000);
  });

  it("answers null outside Topstep mode", () => {
    expect(topstepStateAt(cfg({ enabled: false }), book, "2026-09-29T15:00:00Z")).toBeNull();
  });
});

describe("the risk budget at entry (F3, E4)", () => {
  const book = [t("2026-09-28T15:00:00Z", 1_000), t("2026-09-29T14:00:00Z", -400)];
  const rule = { pct: 12.5, min: null, max: null };

  it("is the trader's rule on the room and the DLL left at that moment", () => {
    // Room 1 600 → 12.5 % = 200, inside 60–300, under DLL left 600.
    expect(riskBudgetAt(cfg(), rule, book, "2026-09-29T15:00:00Z")).toBe(200);
  });

  it("before the Monday win the room was 2 000 → 250", () => {
    expect(riskBudgetAt(cfg(), rule, book, "2026-09-28T13:00:00Z")).toBe(250);
  });

  it("the account's own overrides win over the plan's bounds", () => {
    expect(riskBudgetAt(cfg(), { pct: 12.5, min: null, max: 150 }, book, "2026-09-28T13:00:00Z")).toBe(150);
  });

  it("near the MLL the plan's floor no longer holds: $500 of room risks 12.5 % of it, not $60 (R3)", () => {
    const close = [t("2026-09-28T15:00:00Z", -1_500)];
    expect(riskBudgetAt(cfg(), rule, close, "2026-09-29T15:00:00Z")).toBe(62.5);
    const closer = [t("2026-09-28T15:00:00Z", -1_700)];
    expect(riskBudgetAt(cfg(), rule, closer, "2026-09-29T15:00:00Z")).toBe(37.5);
  });

  it("is 0 on an account with no room — nothing was allowed, which is an answer", () => {
    const blown = [t("2026-09-28T15:00:00Z", -2_000)];
    expect(riskBudgetAt(cfg(), rule, blown, "2026-09-29T15:00:00Z")).toBe(0);
  });

  it("is null outside Topstep mode", () => {
    expect(riskBudgetAt(cfg({ enabled: false }), rule, book, "2026-09-29T15:00:00Z")).toBeNull();
  });
});

describe("headroom: the closest the account came to its floor (F3, E6)", () => {
  it("is the smallest room ever seen, as a share of the MLL", () => {
    // Down 1 500 on Monday (room 500 of 2 000 = 25 %), then back up.
    const r = run([t("2026-09-28T15:00:00Z", -1_500), t("2026-09-29T15:00:00Z", 1_400)]);
    expect(r.headroomPct).toBe(25);
  });

  it("counts the overnight trail: a high close raises the floor under the balance", () => {
    // +1 900 Monday: EOD 51 900 pulls the floor to 49 900. Tuesday -1 500: room 500.
    const r = run([t("2026-09-28T15:00:00Z", 1_900), t("2026-09-29T15:00:00Z", -1_500)]);
    expect(r.headroomPct).toBe(25);
  });

  it("is null with no trades — nothing was tested", () => {
    expect(run([]).headroomPct).toBeNull();
  });

  it("is 0 once the floor was touched", () => {
    expect(run([t("2026-09-28T15:00:00Z", -2_100)]).headroomPct).toBe(0);
  });
});

describe("TopstepX Risk Limits: the personal daily loss limit and profit target (30.09.2026)", () => {
  it("makes the personal limit the day's DLL where it is tighter than the plan's", () => {
    const r = run([t("2026-09-30T14:00:00Z", -300)], { personalDll: 600 });
    expect(r.rules.dll).toBe(600);
    expect(r.personalDll).toBe(true);
    expect(r.dllLeftToday).toBe(300);
  });

  it("keeps the plan's DLL when the personal one is looser — Topstep still stops there", () => {
    const r = run([], { personalDll: 5_000 });
    expect(r.rules.dll).toBe(1_000);
    expect(r.personalDll).toBe(false);
  });

  it("counts a stopped day at the personal limit", () => {
    const r = run([t("2026-09-29T14:00:00Z", -700)], { personalDll: 600 });
    expect(r.dllDays).toEqual(["2026-09-29"]);
  });

  it("says how much of the daily target is still missing today, and 0 once banked", () => {
    expect(run([t("2026-09-30T14:00:00Z", 200)], { dailyTarget: 500 }).targetLeftToday).toBe(300);
    expect(run([t("2026-09-30T14:00:00Z", 650)], { dailyTarget: 500 }).targetLeftToday).toBe(0);
    const none = run([]);
    expect(none.dailyTarget).toBeNull();
    expect(none.targetLeftToday).toBeNull();
  });

  it("sizes from the personal DLL left today", () => {
    // 50K: room 2 000 → 12.5 % = 250; the personal 600 already lost 450, so 150 is left.
    const trades = [t("2026-09-30T14:00:00Z", -450)];
    const budget = riskBudgetAt(cfg({ personalDll: 600 }), { pct: 12.5, min: null, max: null }, trades, "2026-09-30T15:00:00Z");
    expect(budget).toBeLessThanOrEqual(150);
  });
});

describe("150K: the MLL trails to the starting balance and stops there (30.09.2026)", () => {
  const big = (trades: TopstepTrade[], over: Partial<TopstepConfig> = {}) =>
    run(trades, { plan: "150K", startingBalance: 150_000, ...over });

  it("starts 4 500 under the start and follows the day's close up", () => {
    expect(big([]).mllFloor).toBe(145_500);
    const r = big([t("2026-09-28T15:00:00Z", 2_000)]);
    expect(r.mllFloor).toBe(147_500);
    expect(r.room).toBe(4_500);
  });

  it("stops at 150 000 once a day closes at 154 500, and stays through losses", () => {
    const r = big([t("2026-09-24T15:00:00Z", 6_000), t("2026-09-25T15:00:00Z", -1_000)]);
    expect(r.mllFloor).toBe(150_000);
    expect(r.mllLocked).toBe(true);
    expect(r.room).toBe(5_000);
  });
});

describe("a payout leaves the balance; the MLL stays at the starting balance (30.09.2026)", () => {
  const payout = (at: string, amount: number) => ({ at, amount });

  it("$6 000 with a $2 000 payout is $4 000 of room above the start", () => {
    // 50K: +6 000 over two days, then $2 000 paid out.
    const r = run([t("2026-09-24T15:00:00Z", 3_000), t("2026-09-25T15:00:00Z", 3_000)], {
      payouts: [payout("2026-09-28T15:00:00Z", 2_000)],
    });
    expect(r.balance).toBe(54_000);
    expect(r.mllFloor).toBe(50_000);
    expect(r.mllLocked).toBe(true);
    expect(r.room).toBe(4_000);
    expect(r.paidOut).toBe(2_000);
    // The trading profit is still what was traded, not what is left.
    expect(r.profit).toBe(6_000);
    expect(r.status).not.toBe("failed");
  });

  it("the first payout locks the floor even before the trail reached the start", () => {
    // +1 000: the floor had trailed only to 49 000; the payout puts it at 50 000.
    const r = run([t("2026-09-24T15:00:00Z", 1_000)], { payouts: [payout("2026-09-28T15:00:00Z", 500)] });
    expect(r.balance).toBe(50_500);
    expect(r.mllFloor).toBe(50_000);
    expect(r.room).toBe(500);
  });

  it("a loss after the payout is measured against the start", () => {
    const r = run(
      [t("2026-09-24T15:00:00Z", 3_000), t("2026-09-29T15:00:00Z", -1_200)],
      { payouts: [payout("2026-09-28T15:00:00Z", 1_500)] },
    );
    expect(r.balance).toBe(50_300);
    expect(r.room).toBe(300);
  });

  it("a payout still to come changes nothing yet, and one before a reset is forgotten", () => {
    expect(run([], { payouts: [payout("2026-10-05T15:00:00Z", 500)] }).balance).toBe(50_000);
    const r = run([], { resetAt: "2026-09-26T00:00:00Z", payouts: [payout("2026-09-25T15:00:00Z", 500)] });
    expect(r.balance).toBe(50_000);
    expect(r.mllFloor).toBe(48_000);
  });

  it("the budget at an entry after the payout comes from what is left", () => {
    const trades = [t("2026-09-24T15:00:00Z", 3_000)];
    const cfg2 = cfg({ payouts: [payout("2026-09-28T15:00:00Z", 2_000)] });
    // Room 1 000 after the payout: 12.5 % = 125.
    expect(riskBudgetAt(cfg2, { pct: 12.5, min: null, max: null }, trades, "2026-09-29T15:00:00Z")).toBe(125);
  });

  it("reads payouts and withdrawals off the account's cash events, not deposits", async () => {
    const { topstepPayoutsOf } = await import("./topstep");
    const ev = (id: string, account_id: string, event_type: string, amount: number, occurred_at: string) =>
      ({ id, account_id, event_type, amount, occurred_at, note: null }) as never;
    expect(
      topstepPayoutsOf("a", [
        ev("1", "a", "payout", -2_000, "2026-09-28T15:00:00Z"),
        ev("2", "a", "deposit", 500, "2026-09-20T15:00:00Z"),
        ev("3", "b", "payout", -900, "2026-09-21T15:00:00Z"),
        ev("4", "a", "withdrawal", -300, "2026-09-10T15:00:00Z"),
      ]),
    ).toEqual([
      { at: "2026-09-10T15:00:00Z", amount: 300 },
      { at: "2026-09-28T15:00:00Z", amount: 2_000 },
    ]);
  });
});

describe("the room the plan's risk floor holds from (R3, 30.09.2026)", () => {
  it("is a third of the plan's MLL: 150K $1 500, 100K $1 000, 50K $666.67", () => {
    expect(topstepMinRiskFromRoom(TOPSTEP_PLANS["150K"])).toBe(1_500);
    expect(topstepMinRiskFromRoom(TOPSTEP_PLANS["100K"])).toBe(1_000);
    expect(topstepMinRiskFromRoom(TOPSTEP_PLANS["50K"])).toBeCloseTo(666.67, 2);
  });

  it("does not move with a tighter personal DLL", () => {
    expect(topstepMinRiskFromRoom({ ...TOPSTEP_PLANS["150K"], dll: 1_200 })).toBe(1_500);
  });
});

describe("Express Funded Account: the Scaling Plan (phase T, 30.09.2026)", () => {
  const xfa = (over: Partial<TopstepConfig> = {}) => ({ stage: "xfa" as const, startingBalance: 0, ...over });

  it("the tiers are Topstep's, by the XFA balance", () => {
    const tiers = (plan: "50K" | "100K" | "150K") =>
      [-100, 0, 1_499.99, 1_500, 1_999.99, 2_000, 2_999.99, 3_000, 4_499.99, 4_500, 20_000].map((b) =>
        topstepScalingMaxMini(plan, b),
      );
    expect(tiers("50K")).toEqual([2, 2, 2, 3, 3, 5, 5, 5, 5, 5, 5]);
    expect(tiers("100K")).toEqual([3, 3, 3, 4, 4, 5, 5, 10, 10, 10, 10]);
    expect(tiers("150K")).toEqual([3, 3, 3, 4, 4, 5, 5, 10, 10, 15, 15]);
  });

  it("a fresh XFA starts at $0 with the MLL under it, and holds the lowest tier", () => {
    const r = run([], xfa());
    expect(r.stage).toBe("xfa");
    expect(r.balance).toBe(0);
    expect(r.mllFloor).toBe(-2_000);
    expect(r.rules.maxMini).toBe(2);
    expect(r.nextMaxMini).toBe(2);
  });

  it("today's size is set by the balance at the last close; today's win raises the next session", () => {
    const r = run([t("2026-09-29T15:00:00Z", 1_600), t("2026-09-30T14:00:00Z", 500)], xfa());
    expect(r.rules.maxMini).toBe(3);                          // $1 600 at Tuesday's close
    expect(r.nextMaxMini).toBe(5);                            // $2 100 now
  });

  it("a payout lowers the tier with the balance", () => {
    const r = run(
      [t("2026-09-28T15:00:00Z", 5_000)],
      xfa({ plan: "150K", payouts: [{ at: "2026-09-29T18:00:00Z", amount: 2_000 }] }),
    );
    expect(r.balance).toBe(3_000);
    expect(r.rules.maxMini).toBe(10);                         // not 15
    expect(r.mllFloor).toBe(0);                               // after the first payout the floor is $0
  });

  it("a Combine keeps the plan's whole size from the first day", () => {
    expect(run([]).rules.maxMini).toBe(5);
    expect(run([]).stage).toBe("combine");
    expect(run([]).xfa).toBeNull();
  });
});

describe("Express Funded Account: no target, two payout paths (phase T)", () => {
  const xfa = (over: Partial<TopstepConfig> = {}) => ({ stage: "xfa" as const, startingBalance: 0, ...over });
  const days = (...nets: number[]) =>
    ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-28", "2026-09-29"]
      .slice(0, nets.length)
      .map((d, i) => t(`${d}T15:00:00Z`, nets[i]));

  it("is never 'passed' — an XFA has no profit target", () => {
    const r = run(days(1_500, 1_600), xfa());
    expect(r.status).toBe("active");
    expect(run(days(1_500, 1_600)).status).toBe("passed");   // the same on a Combine
  });

  it("Standard: five winning days of $150 or more", () => {
    expect(run(days(150, 150, 150, 150, 150), xfa()).xfa!.standard.eligible).toBe(true);
    const r = run(days(150, 150, 150, 150, 149), xfa());
    expect(r.xfa!.winningDays).toBe(4);
    expect(r.xfa!.standard.eligible).toBe(false);
  });

  it("Consistency: three traded days, the best at most 40 % of the net profit", () => {
    const ok = run(days(100, 100, 50), xfa()).xfa!;
    expect(ok.consistency.bestShare).toBeCloseTo(0.4, 10);
    expect(ok.consistency.eligible).toBe(true);
    expect(run(days(100, 100, 40), xfa()).xfa!.consistency.eligible).toBe(false);  // 41.7 %
    expect(run(days(100, 100), xfa()).xfa!.consistency.eligible).toBe(false);      // two days
  });

  it("counting starts again after a payout", () => {
    const r = run(days(900, 900, 900, 900, 900, 200, 200), xfa({ payouts: [{ at: "2026-09-25T20:00:00Z", amount: 2_000 }] }));
    expect(r.xfa!.daysTraded).toBe(2);
    expect(r.xfa!.winningDays).toBe(2);
    expect(r.xfa!.netProfit).toBe(400);
    expect(r.xfa!.standard.eligible).toBe(false);
  });

  it("the largest request: half the balance, capped by plan and path, at least $125", () => {
    const r = run(days(1_000, 1_000, 1_000), xfa());                        // 50K, $3 000
    expect(r.xfa!.standard.maxPayout).toBe(1_500);
    expect(r.xfa!.consistency.maxPayout).toBe(1_500);
    const big = run(days(4_000, 4_000), xfa());                              // $8 000
    expect([big.xfa!.standard.maxPayout, big.xfa!.consistency.maxPayout]).toEqual([2_000, 3_000]);
    const b150 = run(days(8_000, 8_000), xfa({ plan: "150K" }));            // $16 000
    expect([b150.xfa!.standard.maxPayout, b150.xfa!.consistency.maxPayout]).toEqual([5_000, 6_000]);
    expect(run(days(200), xfa()).xfa!.standard.maxPayout).toBe(0);          // half is $100 < $125
  });
});
