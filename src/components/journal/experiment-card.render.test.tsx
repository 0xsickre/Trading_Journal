import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExperimentCard } from "./experiment-card";
import type { ExperimentSummary } from "@/lib/journal/experiments";

const startExperimentMock = vi.fn();
const endExperimentMock = vi.fn();
vi.mock("@/app/(app)/weekly/actions", () => ({
  startExperiment: (...a: unknown[]) => startExperimentMock(...a),
  endExperiment: (...a: unknown[]) => endExperimentMock(...a),
}));

const summary = (over: Partial<ExperimentSummary> = {}): ExperimentSummary => ({
  experiment: {
    id: "e1",
    started_week: "2026-03-02",
    hypothesis: "Ne trgujem prvi sat",
    metric_key: "win_rate",
    baseline_weeks: 4,
    ended_week: null,
    status: "running",
  },
  metricLabel: "Win %",
  unit: "pct",
  higherIsBetter: true,
  before: 40,
  after: 60,
  delta: 20,
  interval: { lo: -5, hi: 45, n: 12 },
  beforeN: 20,
  afterN: 12,
  verdict: "unknown",
  window: {
    beforeFrom: "2026-02-02",
    beforeTo: "2026-02-23",
    afterFrom: "2026-03-02",
    afterTo: "2026-03-30",
  },
  ...over,
});

beforeEach(() => {
  startExperimentMock.mockReset().mockResolvedValue({ ok: true });
  endExperimentMock.mockReset().mockResolvedValue({ ok: true });
});

const card = (summaries: ExperimentSummary[], disabled = false) =>
  render(
    <ExperimentCard
      weekStart="2026-03-30"
      summaries={summaries}
      oneChange="Ne trgujem prvi sat"
      disabled={disabled}
    />,
  );

describe("ExperimentCard", () => {
  it("shows both windows and refuses a verdict while the gap holds zero", () => {
    card([summary()]);

    expect(screen.getByText("40.0%")).toBeInTheDocument();
    expect(screen.getByText("60.0%")).toBeInTheDocument();
    expect(screen.getByText("+20.0%")).toBeInTheDocument();
    // The sample it is worth, and the refusal in words.
    expect(screen.getByText(/još ne znaš/)).toBeInTheDocument();
    expect(screen.getByText(/n=12/)).toBeInTheDocument();
  });

  it("says what it does not control, every time", () => {
    card([summary()]);
    expect(screen.getByText(/Nekontrolisano/)).toBeInTheDocument();
    expect(screen.getByText(/tvoja reč o tvom ponašanju/)).toBeInTheDocument();
  });

  it("names a real improvement once the interval has cleared zero", () => {
    card([summary({ verdict: "better", interval: { lo: 8, hi: 40, n: 30 } })]);
    expect(screen.getByText("bolje")).toBeInTheDocument();
  });

  it("asks for more trades instead of comparing two handfuls", () => {
    card([summary({ verdict: "thin", interval: null, beforeN: 3, afterN: 2 })]);
    expect(screen.getByText(/premalo trejdova/)).toBeInTheDocument();
    expect(screen.getByText(/3 pre i 2 posle/)).toBeInTheDocument();
  });

  it("starts one from this week's change, prefilled", async () => {
    const user = userEvent.setup({ delay: null });
    card([]);

    await user.click(screen.getByRole("button", { name: "Prati ovo kao eksperiment" }));
    expect(screen.getByRole("textbox")).toHaveValue("Ne trgujem prvi sat");

    await user.click(screen.getByRole("button", { name: "Pokreni" }));
    expect(startExperimentMock).toHaveBeenCalledWith("2026-03-30", {
      hypothesis: "Ne trgujem prvi sat",
      metric_key: "win_rate",
    });
  });

  it("offers no second experiment for a week that already has one", () => {
    card([summary({ experiment: { ...summary().experiment, started_week: "2026-03-30" } })]);
    expect(
      screen.queryByRole("button", { name: "Prati ovo kao eksperiment" }),
    ).not.toBeInTheDocument();
  });

  it("finishes one as kept", async () => {
    const user = userEvent.setup({ delay: null });
    card([summary()]);
    await user.click(screen.getByRole("button", { name: "Zadrži" }));
    expect(endExperimentMock).toHaveBeenCalledWith("e1", "kept");
  });

  it("keeps a finished experiment readable, with what it concluded", () => {
    card([
      summary({
        experiment: {
          ...summary().experiment,
          status: "dropped",
          ended_week: "2026-03-23",
        },
        verdict: "worse",
      }),
    ]);
    expect(screen.getByText(/odbačeno/)).toBeInTheDocument();
    expect(screen.getByText(/gore/)).toBeInTheDocument();
  });

  it("writes nothing on a sealed week", () => {
    card([summary()], true);
    expect(screen.getByRole("button", { name: "Zadrži" })).toBeDisabled();
  });
});
