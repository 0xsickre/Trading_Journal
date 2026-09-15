import { describe, expect, it } from "vitest";
import { processAdherence, PROCESS_BLEND } from "./process-adherence";
import { computeSickreScore } from "../sickre-score";

const base = {
  profitFactor: 2.0,
  avgWinLossRatio: 2.0,
  maxDrawdownPctOfPeakPnl: 20,
  recoveryFactor: 2.0,
  consistencyScore: 70,
  sample: { trades: 30, decided: 30 },
};

describe("processAdherence", () => {
  it("is null when neither signal exists", () => {
    // An unmeasured process is not a bad one. The score drops the component and
    // renormalizes rather than scoring a new trader at zero.
    expect(processAdherence({ trackerPct: null, followRatePct: null })).toBeNull();
  });

  it("returns the surviving signal UNSCALED when the other is missing", () => {
    // "The other × its weight" would score a flawless tracker with no playbook
    // answers at 60/100 and call that a process problem.
    expect(processAdherence({ trackerPct: 100, followRatePct: null })).toBe(100);
    expect(processAdherence({ trackerPct: null, followRatePct: 80 })).toBe(80);
  });

  it("weights the tracker above the follow rate when both exist", () => {
    expect(processAdherence({ trackerPct: 100, followRatePct: 50 })).toBe(80);
    expect(processAdherence({ trackerPct: 50, followRatePct: 100 })).toBe(70);
  });

  it("respects a custom blend", () => {
    expect(
      processAdherence({ trackerPct: 100, followRatePct: 0 }, { tracker: 50, follow: 50 }),
    ).toBe(50);
  });

  it("counts zero as a score, never as missing data", () => {
    // A truthiness check here would reward total non-compliance by dropping the
    // component. This is the assertion that pins that.
    expect(processAdherence({ trackerPct: 0, followRatePct: 0 })).toBe(0);
    expect(processAdherence({ trackerPct: 0, followRatePct: null })).toBe(0);

    const r = computeSickreScore({ ...base, processAdherencePct: 0 });
    const process = r.components.find((c) => c.key === "process")!;
    expect(process.counted).toBe(true);
    expect(process.score).toBe(0);
  });

  it("keeps the documented blend as data, not as a magic number", () => {
    expect(PROCESS_BLEND.tracker + PROCESS_BLEND.follow).toBe(100);
  });
});

describe("the heaviest component in the score", () => {
  it("is absent, and coverage complete, when nothing is supplied", () => {
    const r = computeSickreScore(base);
    expect(r.components).toHaveLength(5);
    expect(r.coverage).toBe(70);
    expect(r.maxCoverage).toBe(70);
  });

  it("raises the maximum to 100 once supplied", () => {
    const r = computeSickreScore({ ...base, processAdherencePct: 80 });
    expect(r.components).toHaveLength(6);
    expect(r.coverage).toBe(100);
    expect(r.maxCoverage).toBe(100);
  });

  it("reports a partial score as partial rather than as fully covered", () => {
    // The display bug this exists to prevent: with recovery missing the score
    // covers 95 of 100, and a hardcoded total would have rendered it complete.
    const r = computeSickreScore({
      ...base,
      recoveryFactor: null,
      processAdherencePct: 80,
    });
    expect(r.coverage).toBe(95);
    expect(r.maxCoverage).toBe(100);
    expect(r.coverage).toBeLessThan(r.maxCoverage);
  });

  it("moves the score in the direction of the process figure", () => {
    const poor = computeSickreScore({ ...base, processAdherencePct: 0 });
    const great = computeSickreScore({ ...base, processAdherencePct: 100 });
    expect(great.score!).toBeGreaterThan(poor.score!);
  });

  it("carries more weight than any outcome component", () => {
    // The rebalance, stated where the process component is defined. Over forty
    // trades a year the outcome components are measured on a sample too thin to
    // trust; tracker compliance and follow rate measure behaviour, where n=40
    // already means something.
    const r = computeSickreScore({ ...base, processAdherencePct: 80 });
    const process = r.components.find((c) => c.key === "process")!;
    for (const other of r.components.filter((c) => c.key !== "process")) {
      expect(process.weight, other.key).toBeGreaterThan(other.weight);
    }
  });
});
