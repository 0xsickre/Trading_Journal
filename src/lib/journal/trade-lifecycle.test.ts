import { describe, expect, it } from "vitest";
import {
  canMarkMissed,
  canRestoreToPlanned,
  computeStatus,
  fillTotals,
  formatLifecycleStatusLabel,
  hasEntryFill,
  isValidFill,
  openQty,
  overExitMessage,
  lifecycleStatusHint,
  statusToTradePhase,
  addsExposure,
  asFillSource,
  validateFills,
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

  it("no fills + active (open) stays open", () => {
    expect(computeStatus([], "open")).toBe("open");
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

describe("hasEntryFill", () => {
  it("detects entry qty", () => {
    expect(hasEntryFill([entry])).toBe(true);
    expect(hasEntryFill([{ ...entry, side: "exit" }])).toBe(false);
    expect(hasEntryFill([])).toBe(false);
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

describe("isValidFill", () => {
  const fill = (over: Partial<Parameters<typeof isValidFill>[0]> = {}) => ({
    side: "entry" as const,
    price: 100,
    qty: 1,
    ...over,
  });

  it("accepts a complete fill on either side", () => {
    expect(isValidFill(fill())).toBe(true);
    expect(isValidFill(fill({ side: "exit" }))).toBe(true);
  });

  it("rejects qty 0 — the case that used to eat a commission", () => {
    // The docblock records the bug: the form accepted qty 0 while the server
    // dropped the row, taking the fee and swap typed on it. One predicate now,
    // and this is the input that proves the two agree.
    expect(isValidFill(fill({ qty: 0 }))).toBe(false);
    expect(isValidFill(fill({ qty: -1 }))).toBe(false);
  });

  it("rejects a non-finite number rather than letting NaN through", () => {
    expect(isValidFill(fill({ price: Number.NaN }))).toBe(false);
    expect(isValidFill(fill({ qty: Number.NaN }))).toBe(false);
    expect(isValidFill(fill({ price: Number.POSITIVE_INFINITY }))).toBe(false);
  });

  it("rejects a missing price or qty", () => {
    expect(isValidFill(fill({ price: null }))).toBe(false);
    expect(isValidFill(fill({ qty: null }))).toBe(false);
  });

  it("rejects a side the schema does not allow", () => {
    expect(isValidFill({ ...fill(), side: "both" } as never)).toBe(false);
  });
});

describe("every stored status has a label and a hint", () => {
  // The five values are the DB CHECK on `tj_positions.status`
  // (`planned | missed | open | partial | closed`). Both switches fall through
  // to the raw value / an empty string, so a status added to the schema without
  // a label here surfaces in the grid as `partial` rather than "Partial" — a
  // silent gap, since neither branch errors.
  const STORED_STATUSES = ["planned", "missed", "open", "partial", "closed"];

  it("labels all five, and never echoes the raw value", () => {
    for (const s of STORED_STATUSES) {
      const label = formatLifecycleStatusLabel(s);
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toBe(s);
    }
  });

  it("hints all five", () => {
    for (const s of STORED_STATUSES) {
      expect(lifecycleStatusHint(s).length).toBeGreaterThan(0);
    }
  });

  it("degrades rather than throwing on an unknown status", () => {
    expect(formatLifecycleStatusLabel("zzz")).toBe("zzz");
    expect(lifecycleStatusHint("zzz")).toBe("");
  });
});

describe("statusToTradePhase", () => {
  it("calls a position with fills active, everything else planned", () => {
    for (const s of ["open", "partial", "closed"]) {
      expect(statusToTradePhase(s)).toBe("active");
    }
    for (const s of ["planned", "missed", "", null, undefined, "unknown"]) {
      expect(statusToTradePhase(s)).toBe("planned");
    }
  });
});

describe("validateFills", () => {
  const at = (h: number) => `2026-04-01T${String(h).padStart(2, "0")}:00:00.000Z`;

  it("accepts a plan, an open position, and a clean round trip", () => {
    expect(validateFills([])).toBeNull();
    expect(validateFills([{ side: "entry", qty: 1, executedAt: at(9) }])).toBeNull();
    expect(
      validateFills([
        { side: "entry", qty: 2, executedAt: at(9) },
        { side: "exit", qty: 1, executedAt: at(10) },
        { side: "exit", qty: 1, executedAt: at(11) },
      ]),
    ).toBeNull();
  });

  it("refuses a fill with no readable time instead of dating it 'now'", () => {
    expect(validateFills([{ side: "entry", qty: 1, executedAt: null }])).toBe(
      "Fill 1 needs a valid time.",
    );
  });

  it("refuses an exit with no entry", () => {
    expect(validateFills([{ side: "exit", qty: 1, executedAt: at(9) }])).toMatch(/needs an entry/);
  });

  it("refuses closing more than was opened, with float tolerance", () => {
    expect(
      validateFills([
        { side: "entry", qty: 1, executedAt: at(9) },
        { side: "exit", qty: 2, executedAt: at(10) },
      ]),
    ).toMatch(/Exits total 2 but entries only 1/);
    expect(
      validateFills([
        { side: "entry", qty: 0.1, executedAt: at(9) },
        { side: "entry", qty: 0.2, executedAt: at(9) },
        { side: "exit", qty: 0.3, executedAt: at(10) },
      ]),
    ).toBeNull();
  });

  it("refuses an exit before the first entry, naming the row", () => {
    expect(
      validateFills([
        { side: "entry", qty: 1, executedAt: at(10) },
        { side: "exit", qty: 1, executedAt: at(9) },
      ]),
    ).toBe("Fill 2 exits before the first entry.");
  });
});

describe("openQty", () => {
  it("what is left of the position", () => {
    expect(openQty(4.78, 0)).toBe(4.78);
    expect(openQty(4.78, 3)).toBeCloseTo(1.78, 10);
    expect(openQty(2, 2)).toBe(0);
  });

  it("clamps at zero — an over-exit is bad data, not a negative position", () => {
    expect(openQty(1, 2)).toBe(0);
  });
});

describe("fillTotals", () => {
  it("adds up each side and what stays open", () => {
    // Raw sums, NOT rounded: this is the arithmetic, and the rounding belongs
    // to the one place a quantity is written for a human — `qtyToInput`.
    const t = fillTotals([
      { side: "entry", qty: 2 },
      { side: "entry", qty: 2.78 },
      { side: "exit", qty: 3 },
    ]);
    expect(t.entryQty).toBeCloseTo(4.78, 10);
    expect(t.exitQty).toBe(3);
    expect(t.openQty).toBeCloseTo(1.78, 10);
  });

  it("nothing in, nothing out", () => {
    expect(fillTotals([])).toEqual({ entryQty: 0, exitQty: 0, openQty: 0 });
  });

  it("an unreadable quantity counts as none rather than poisoning the total", () => {
    // The editor holds quantities as text; a half-typed row arrives as NaN,
    // and one NaN used to make every figure on the screen NaN.
    expect(
      fillTotals([
        { side: "entry", qty: 2 },
        { side: "entry", qty: Number.NaN },
      ]),
    ).toEqual({ entryQty: 2, exitQty: 0, openQty: 2 });
  });
});

describe("overExitMessage", () => {
  it("silent while the exits fit inside the entries", () => {
    expect(overExitMessage(2, 0)).toBeNull();
    expect(overExitMessage(2, 2)).toBeNull();
    expect(overExitMessage(0.1 + 0.2, 0.3)).toBeNull();
  });

  it("names both totals when more is closed than was opened", () => {
    expect(overExitMessage(1, 2)).toBe(
      "Exits total 2 but entries only 1 — a position cannot close more than was opened.",
    );
  });

  it("is the same sentence validateFills refuses with", () => {
    // One rule, one wording: the fills editor says this live and the save path
    // says it on submit, and they must not diverge.
    const at = (h: number) => `2026-04-01T${String(h).padStart(2, "0")}:00:00.000Z`;
    expect(
      validateFills([
        { side: "entry", qty: 1, executedAt: at(9) },
        { side: "exit", qty: 2, executedAt: at(10) },
      ]),
    ).toBe(overExitMessage(1, 2));
  });
});

describe("addsExposure (the FTMO freeze)", () => {
  it("lets a closed trade's record be edited", () => {
    expect(addsExposure({ status: "closed", entryQty: 1 }, { status: "closed", entryQty: 1 })).toBe(false);
  });
  it("refuses a plan becoming a live trade", () => {
    expect(addsExposure({ status: "planned", entryQty: 0 }, { status: "open", entryQty: 1 })).toBe(true);
    expect(addsExposure({ status: "missed", entryQty: 0 }, { status: "open", entryQty: 0 })).toBe(true);
  });
  it("refuses more size on a live trade, allows less", () => {
    expect(addsExposure({ status: "open", entryQty: 1 }, { status: "open", entryQty: 2 })).toBe(true);
    expect(addsExposure({ status: "open", entryQty: 2 }, { status: "partial", entryQty: 2 })).toBe(false);
  });
  it("lets a plan stay a plan", () => {
    expect(addsExposure({ status: "planned", entryQty: 0 }, { status: "planned", entryQty: 0 })).toBe(false);
  });
});

describe("asFillSource", () => {
  it("keeps a known origin and defaults anything else to manual", () => {
    expect(asFillSource("import")).toBe("import");
    expect(asFillSource("bot")).toBe("bot");
    expect(asFillSource("broker")).toBe("manual");
    expect(asFillSource(undefined)).toBe("manual");
  });
});
