import { describe, expect, it } from "vitest";
import {
  canMarkMissed,
  canRestoreToPlanned,
  computeStatus,
  type ExecutionInput,
} from "./trade-lifecycle";

const entry: ExecutionInput = {
  side: "entry",
  price: 100,
  qty: 1,
  executed_at: "2026-01-01T00:00:00Z",
  fee: 0,
  swap_funding: 0,
};

describe("computeStatus", () => {
  it("no fills → planned by default", () => {
    expect(computeStatus([])).toBe("planned");
  });

  it("no fills + missed stays missed", () => {
    expect(computeStatus([], "missed")).toBe("missed");
  });

  it("entry only → open", () => {
    expect(computeStatus([entry])).toBe("open");
  });

  it("partial exit", () => {
    expect(
      computeStatus([
        entry,
        { ...entry, side: "exit", qty: 0.5 },
      ]),
    ).toBe("partial");
  });

  it("full exit → closed", () => {
    expect(
      computeStatus([entry, { ...entry, side: "exit" }]),
    ).toBe("closed");
  });
});

describe("canMarkMissed", () => {
  it("planned without fills", () => {
    expect(canMarkMissed(0, "planned")).toBe(true);
  });

  it("not when has fills", () => {
    expect(canMarkMissed(1, "planned")).toBe(false);
  });

  it("not when already missed", () => {
    expect(canMarkMissed(0, "missed")).toBe(false);
  });
});

describe("canRestoreToPlanned", () => {
  it("missed without fills", () => {
    expect(canRestoreToPlanned(0, "missed")).toBe(true);
  });

  it("not when planned", () => {
    expect(canRestoreToPlanned(0, "planned")).toBe(false);
  });
});
