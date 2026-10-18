import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DailyBiasCard } from "./daily-bias-card";
import { parseDailyBias, summarizeBias, type DailyBias } from "@/lib/journal/daily-bias";

vi.mock("@/app/(app)/daily/bias-actions", () => ({ addDailyBias: vi.fn() }));

const bias = (over: Record<string, unknown>) =>
  parseDailyBias({
    id: "b1",
    trading_day: "2026-10-19",
    root: "NQ",
    bias: "gore",
    reason: null,
    set_at: "2026-10-19T05:12:00Z",
    eval_status: null,
    ...over,
  }) as DailyBias;

const empty = summarizeBias([], () => null);

describe("DailyBiasCard", () => {
  it("offers the three directions per root on today's page", () => {
    render(<DailyBiasCard day="2026-10-19" biases={[]} firstEntryOf={{}} canWrite summary={empty} />);
    expect(screen.getByText("Bias dana")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Gore" })).toHaveLength(3);
    expect(screen.getAllByText("nije upisan")).toHaveLength(3);
    expect(screen.getByText(/Još nema ocenjenih dana/)).toBeInTheDocument();
  });

  it("shows the counted forecast, its time in Belgrade, the change and the grade", () => {
    const graded = bias({
      eval_status: "ok",
      eval_start_at: "2026-10-19T07:00:00Z",
      eval_start_price: 25000,
      eval_end_price: 25142,
      eval_move: 142,
      eval_band: 61,
      eval_day: "gore",
      reason: "PDH iznad",
    });
    const change = bias({ id: "b2", bias: "dole", set_at: "2026-10-19T08:30:00Z" });
    render(
      <DailyBiasCard
        day="2026-10-19"
        biases={[change, graded]}
        firstEntryOf={{}}
        canWrite={false}
        summary={summarizeBias([graded, change], () => null)}
      />,
    );
    expect(screen.getByText("upisano 07:12")).toBeInTheDocument();
    expect(screen.getByText("dan Gore +142 (±61) → pogodak")).toBeInTheDocument();
    expect(screen.getByText("PDH iznad")).toBeInTheDocument();
    expect(screen.getByText(/promena u 10:30: Dole \(meri se prvi, 07:12\)/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Gore/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Moj 100 % \(1\/1\)/)).toBeInTheDocument();
    expect(screen.getByText(/Uvek long 100 % \(1\/1\)/)).toBeInTheDocument();
    expect(screen.getByText(/NQ \+142 \/ \+142 poena/)).toBeInTheDocument();
    expect(screen.getByText(/Mali uzorak: 1 od 30/)).toBeInTheDocument();
  });

  it("marks a forecast set after the day's first entry", () => {
    render(
      <DailyBiasCard
        day="2026-10-19"
        biases={[bias({ set_at: "2026-10-19T12:02:00Z" })]}
        firstEntryOf={{ NQ: "2026-10-19T07:24:00Z" }}
        canWrite={false}
        summary={empty}
      />,
    );
    expect(screen.getByText("upisano 14:02, posle prvog ulaza (09:24), ne ocenjuje se")).toBeInTheDocument();
  });
});
