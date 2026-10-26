import { describe, expect, it } from "vitest";
import { dayClose } from "./day-close";
import type { AutoMistake } from "./auto-mistakes";
import type { TradeRow } from "./types";

const row = (id: string, net: number | null, over: Record<string, unknown> = {}): TradeRow =>
  ({
    id,
    trade_no: Number(id.replace(/\D/g, "")) || null,
    status: "closed",
    mistake: [],
    chart_images: [],
    stats: { net_pl: net, realized_r_net: net == null ? null : net / 100, realized_r: null },
    ...over,
  }) as unknown as TradeRow;

const auto = (label: AutoMistake["label"]): AutoMistake => ({ key: "moved_stop", label, reason: "x" });

describe("dayClose (phase B7)", () => {
  it("names the best and the worst closed trade, and whether each has a chart", () => {
    const d = dayClose([row("t1", 50, { chart_images: [{}] }), row("t2", -120), row("t3", 10)], new Map());
    expect(d.closed).toBe(3);
    expect(d.best).toMatchObject({ id: "t1", label: "#1", net: 50, hasChart: true });
    expect(d.worst).toMatchObject({ id: "t2", net: -120, r: -1.2, hasChart: false });
  });

  it("one trade alone is both", () => {
    const d = dayClose([row("t1", -30)], new Map());
    expect(d.best?.id).toBe("t1");
    expect(d.worst?.id).toBe("t1");
  });

  it("leaves out a trade with no price and one still open", () => {
    const d = dayClose([row("t1", null), row("t2", 20, { status: "open" })], new Map());
    expect(d.closed).toBe(0);
    expect(d.best).toBeNull();
    expect(d.mistakes).toEqual([]);
  });

  it("costs each mistake once per trade, manual and auto together, most expensive first", () => {
    const d = dayClose(
      [
        row("t1", -100, { mistake: ["Rani ulaz", "Pomerio stop"] }),
        row("t2", -40, { mistake: ["Bez greške"] }),
        row("t3", 30, { mistake: ["Rani ulaz"] }),
      ],
      new Map([
        ["t1", [auto("Pomerio stop")]],
        ["t2", [auto("Ulaz posle 2 SL")]],
      ]),
    );
    expect(d.mistakes.map((m) => [m.tag, m.trades, m.net, m.auto])).toEqual([
      ["Pomerio stop", 1, -100, true],
      ["Rani ulaz", 2, -70, false],
      ["Ulaz posle 2 SL", 1, -40, true],
    ]);
    expect(d.mistakes[1].r).toBeCloseTo(-0.7, 10);
  });
});
