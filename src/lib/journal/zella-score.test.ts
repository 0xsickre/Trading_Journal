import { describe, expect, it } from "vitest";
import {
  RATIO_BANDS,
  RECOVERY_BANDS,
  computeZellaScore,
  scoreFromBands,
} from "./zella-score";

describe("scoreFromBands", () => {
  it("caps at 100 above the top band", () => {
    expect(scoreFromBands(2.6, RATIO_BANDS)).toBe(100);
    expect(scoreFromBands(5, RATIO_BANDS)).toBe(100);
  });

  it("floors at 20 below the bottom ratio band", () => {
    expect(scoreFromBands(1.79, RATIO_BANDS)).toBe(20);
    expect(scoreFromBands(0.4, RATIO_BANDS)).toBe(20);
  });

  it("interpolates linearly inside a band", () => {
    // 2.40–2.59 maps to 90–99; the band's floor scores its minimum.
    expect(scoreFromBands(2.4, RATIO_BANDS)).toBeCloseTo(90, 6);
    // Halfway between 2.40 and 2.60 → halfway between 90 and 99.
    expect(scoreFromBands(2.5, RATIO_BANDS)).toBeCloseTo(94.5, 6);
  });

  it("scores recovery factor on its own table", () => {
    expect(scoreFromBands(3.5, RECOVERY_BANDS)).toBe(100);
    expect(scoreFromBands(0.9, RECOVERY_BANDS)).toBe(0);
    expect(scoreFromBands(2.0, RECOVERY_BANDS)).toBeCloseTo(50, 6);
  });

  it("returns null for missing input", () => {
    expect(scoreFromBands(null, RATIO_BANDS)).toBeNull();
  });
});

describe("computeZellaScore", () => {
  const full = {
    profitFactor: 2.6,
    avgWinLossRatio: 2.6,
    maxDrawdownPctZella: 0,
    winPct: 60,
    recoveryFactor: 3.5,
    consistencyScore: 100,
  };

  it("scores a perfect book at 100 with full weight coverage", () => {
    const r = computeZellaScore(full);
    expect(r.score).toBe(100);
    expect(r.coverage).toBe(100);
    expect(r.components.every((c) => c.counted)).toBe(true);
  });

  it("uses the documented win % threshold", () => {
    // The spec's worked example: 25 % → 41.67.
    const r = computeZellaScore({ ...full, winPct: 25 });
    const win = r.components.find((c) => c.key === "winPct")!;
    expect(win.score).toBeCloseTo(41.67, 2);
  });

  it("subtracts drawdown percent from 100", () => {
    const r = computeZellaScore({ ...full, maxDrawdownPctZella: 30 });
    const dd = r.components.find((c) => c.key === "maxDrawdown")!;
    expect(dd.score).toBe(70);
  });

  it("clamps an extreme drawdown at zero instead of going negative", () => {
    const r = computeZellaScore({ ...full, maxDrawdownPctZella: 250 });
    expect(r.components.find((c) => c.key === "maxDrawdown")!.score).toBe(0);
  });

  it("drops a component with no data and renormalizes the rest", () => {
    // No drawdown yet → recovery factor is undefined, worth 10 of the 100.
    const r = computeZellaScore({ ...full, recoveryFactor: null });
    expect(r.coverage).toBe(90);
    expect(r.components.find((c) => c.key === "recovery")!.counted).toBe(false);
    // Everything else is perfect, so the score stays 100 rather than dropping
    // to 90 just because one input could not be computed.
    expect(r.score).toBe(100);
  });

  it("weights components as the spec specifies", () => {
    // Only profit factor is perfect; everything else scores zero.
    const r = computeZellaScore({
      profitFactor: 2.6,
      avgWinLossRatio: null,
      maxDrawdownPctZella: 100,
      winPct: 0,
      recoveryFactor: 0.5,
      consistencyScore: 0,
    });
    // PF 100*25 + DD 0*20 + win 0*15 + recovery 0*10 + consistency 0*10
    // over coverage 80 → 31.25
    expect(r.coverage).toBe(80);
    expect(r.score).toBeCloseTo(31.25, 6);
  });

  it("adds the process component only when supplied", () => {
    expect(computeZellaScore(full).components).toHaveLength(6);
    const withProcess = computeZellaScore({
      ...full,
      processAdherencePct: 80,
    });
    expect(withProcess.components).toHaveLength(7);
    expect(withProcess.coverage).toBe(115);
    expect(withProcess.score).toBeLessThan(100);
  });

  it("returns null when nothing can be computed", () => {
    const r = computeZellaScore({
      profitFactor: null,
      avgWinLossRatio: null,
      maxDrawdownPctZella: null,
      winPct: null,
      recoveryFactor: null,
      consistencyScore: null,
    });
    expect(r.score).toBeNull();
    expect(r.coverage).toBe(0);
  });
});
