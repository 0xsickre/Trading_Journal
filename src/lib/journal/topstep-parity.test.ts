import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STOP_SLIPPAGE_TICKS, computeFuturesContracts, computeTopstepRisk } from "./plan-calculations";
import { topstepTradingDay } from "./time";
import {
  TOPSTEP_PLANS,
  TOPSTEP_XFA_PAYOUT,
  TOPSTEP_XFA_SCALING,
  evaluateTopstep,
  topstepMinRiskFromRoom,
  type TopstepPlan,
  type TopstepResult,
  type TopstepStage,
} from "./topstep";

/*
 * The same Topstep cases the morning brief answers (futures-trading
 * `tests/test_topstep_parity.py`, `tools/brief/racun.py`). The JSON is copied byte
 * for byte into both repositories; the pinned sha256 makes a one-sided edit fail
 * here or there, so a rule changes in both or in neither.
 */
const raw = readFileSync(new URL("./topstep-parity.json", import.meta.url), "utf8");
const SHA256 = "ae7be33b9bcb5404d18eff63424e0207429d7c71a2a55e424fb6bd90522f245d";

type Expect = {
  balance: number;
  floor: number;
  room: number;
  locked: boolean;
  todayNet: number;
  dllLeftToday: number;
  maxMini: number;
  nextMaxMini: number;
  targetLeftToday: number | null;
  xfa: { winningDays: number; standard: boolean; standardMax: number; consistency: boolean; consistencyMax: number } | null;
};
type Fixture = {
  constants: {
    plans: Record<TopstepPlan, { mll: number; dll: number; target: number; maxMini: number; riskMin: number; riskMax: number }>;
    xfaScaling: Record<TopstepPlan, [number | null, number][]>;
    xfaPayout: {
      winningDay: number;
      winningDays: number;
      consistencyShare: number;
      consistencyDays: number;
      balanceShare: number;
      minimum: number;
      caps: Record<TopstepPlan, [number, number]>;
    };
    stopSlippageTicks: number;
    minRiskFromRoom: Record<TopstepPlan, number>;
  };
  tradingDay: [string, string][];
  state: {
    name: string;
    plan: TopstepPlan;
    stage: TopstepStage;
    start: number;
    now: string;
    trades: [string, number][];
    payouts: [string, number][];
    payoutAt: string | null;
    resetAt: string | null;
    personalDll: number | null;
    dailyTarget: number | null;
    expect: Expect;
  }[];
  risk: { name: string; plan: TopstepPlan; room: number; dllLeft: number; pct: number; expect: number | null }[];
  contracts: {
    name: string;
    risk: number;
    stop: number;
    pointValue: number;
    commission: number;
    cap: number;
    tick: number | null;
    expect: number;
  }[];
};
const fx = JSON.parse(raw) as Fixture;
const plans = Object.keys(TOPSTEP_PLANS) as TopstepPlan[];

describe("Topstep parity with the brief", () => {
  it("is the pinned copy of the shared cases", () => {
    expect(createHash("sha256").update(raw).digest("hex")).toBe(SHA256);
  });

  it("has the same rule constants", () => {
    expect(TOPSTEP_PLANS).toEqual(fx.constants.plans);
    for (const p of plans) {
      expect(TOPSTEP_XFA_SCALING[p].map(([from, mini]) => [from === -Infinity ? null : from, mini])).toEqual(
        fx.constants.xfaScaling[p],
      );
      const caps = TOPSTEP_XFA_PAYOUT.caps[p];
      expect([caps.standard, caps.consistency]).toEqual(fx.constants.xfaPayout.caps[p]);
      expect(topstepMinRiskFromRoom(TOPSTEP_PLANS[p])).toBeCloseTo(fx.constants.minRiskFromRoom[p], 9);
    }
    const { caps: _caps, ...payout } = TOPSTEP_XFA_PAYOUT;
    const { caps: _fxCaps, ...fxPayout } = fx.constants.xfaPayout;
    expect(payout).toEqual(fxPayout);
    expect(STOP_SLIPPAGE_TICKS).toBe(fx.constants.stopSlippageTicks);
  });

  it.each(fx.tradingDay)("trading day of %s is %s", (iso, day) => {
    expect(topstepTradingDay(iso)).toBe(day);
  });

  it.each(fx.state.map((c) => [c.name, c] as const))("state: %s", (_name, c) => {
    const r = evaluateTopstep(
      {
        enabled: true,
        plan: c.plan,
        stage: c.stage,
        startingBalance: c.start,
        payoutAt: c.payoutAt,
        resetAt: c.resetAt,
        payouts: c.payouts.map(([at, amount]) => ({ at, amount })),
        personalDll: c.personalDll,
        dailyTarget: c.dailyTarget,
      },
      c.trades.map(([closedAt, net]) => ({ closedAt, net })),
      c.now,
    ) as TopstepResult;
    expect({
      balance: r.balance,
      floor: r.mllFloor,
      room: r.room,
      locked: r.mllLocked,
      todayNet: r.todayNet,
      dllLeftToday: r.dllLeftToday,
      maxMini: r.rules.maxMini,
      nextMaxMini: r.nextMaxMini,
      targetLeftToday: r.targetLeftToday,
      xfa: r.xfa && {
        winningDays: r.xfa.winningDays,
        standard: r.xfa.standard.eligible,
        standardMax: r.xfa.standard.maxPayout,
        consistency: r.xfa.consistency.eligible,
        consistencyMax: r.xfa.consistency.maxPayout,
      },
    }).toEqual(c.expect);
  });

  it.each(fx.risk.map((c) => [c.name, c] as const))("risk: %s", (_name, c) => {
    const plan = TOPSTEP_PLANS[c.plan];
    const r = computeTopstepRisk({
      room: c.room,
      pct: c.pct,
      min: plan.riskMin,
      max: plan.riskMax,
      dllLeft: c.dllLeft,
      minFromRoom: topstepMinRiskFromRoom(plan),
    });
    if (c.expect == null) expect(r).toBeNull();
    else expect(r?.amount).toBeCloseTo(c.expect, 9);
  });

  it.each(fx.contracts.map((c) => [c.name, c] as const))("contracts: %s", (_name, c) => {
    // The stop as a distance: entry at the distance, stop at zero, so no float subtraction blurs it.
    const r = computeFuturesContracts({
      riskAmount: c.risk,
      entry: c.stop,
      stop: 0,
      pointValue: c.pointValue,
      commissionPerSide: c.commission,
      maxContracts: c.cap,
      tickSize: c.tick,
    });
    expect(r?.contracts).toBe(c.expect);
  });
});
