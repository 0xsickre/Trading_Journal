import { describe, expect, it } from "vitest";
import { evaluateFtmo, type FtmoConfig, type FtmoTrade } from "./ftmo";

const baseConfig = (over: Partial<FtmoConfig> = {}): FtmoConfig => ({
  enabled: true,
  startingBalance: 100_000,
  timezone: "UTC",
  dailyLoss: { enabled: true, pct: 5 }, // -5000/day
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
    const r = evaluateFtmo(baseConfig({ dailyLoss: { enabled: false, pct: 5 } }), [
      t("2026-07-01T12:00:00Z", -4000),
      t("2026-07-02T12:00:00Z", -4000),
      t("2026-07-03T12:00:00Z", -3000), // equity 89_000 <= 90_000 floor
    ]);
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
    dailyLoss: { enabled: false, pct: 5 },
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
      { ...cfg, resetAt: null, dailyLoss: { enabled: true, pct: 1 } },
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
