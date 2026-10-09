import { describe, expect, it } from "vitest";
import { missedSetupProblem, type MissedSetupInput } from "./missed-setup";

const ok: MissedSetupInput = {
  accountId: "acc",
  instrument: "MNQ",
  direction: "Long",
  entry: 31246.5,
  stop: 31196.25,
  target: 31366.5,
  seenAt: "2026-10-07T14:20:00Z",
  playbookId: null,
  reason: null,
  note: "",
};

describe("missedSetupProblem", () => {
  it("accepts a complete setup", () => {
    expect(missedSetupProblem(ok)).toBeNull();
  });

  it("needs the entry, the stop and the time — a miss without a stop has no R", () => {
    expect(missedSetupProblem({ ...ok, entry: null })).toMatch(/entry/);
    expect(missedSetupProblem({ ...ok, stop: null })).toMatch(/no R/);
    expect(missedSetupProblem({ ...ok, seenAt: null })).toMatch(/When/);
    expect(missedSetupProblem({ ...ok, target: null })).toMatch(/never priced/);
  });

  it("refuses a stop or a target on the wrong side", () => {
    expect(missedSetupProblem({ ...ok, stop: 31300 })).toMatch(/stop below/);
    expect(missedSetupProblem({ ...ok, direction: "Short", stop: 31300, target: 31300 })).toMatch(/target below/);
  });
});
