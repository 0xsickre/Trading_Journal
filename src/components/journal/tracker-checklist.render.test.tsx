import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TrackerStageSection, type TrackerDayData } from "./tracker-checklist";
import type { TrackerRule } from "@/lib/journal/tracker-types";

/**
 * "da zaključan dan zaista onemogući čekiranje" — the plan's own stated goal
 * for this step. `locked` has to remove the interactive control entirely,
 * not just disable it, because a disabled-but-present button is a UI promise
 * the day can still be checked that the database will then refuse.
 */

const setCheckinMock = vi.fn();
vi.mock("@/app/(app)/daily/tracker-actions", () => ({
  setCheckin: (...a: unknown[]) => setCheckinMock(...a),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

function rule(over: Partial<TrackerRule> & { id: string; text: string }): TrackerRule {
  return {
    stage: "prepare",
    active_days: [1, 2, 3, 4, 5],
    auto_key: null,
    config: {},
    is_mandatory: true,
    sort_order: 0,
    created_at: "2026-01-01T00:00:00Z",
    retired_at: null,
    ...over,
  } as unknown as TrackerRule;
}

function data(over: Partial<TrackerDayData> = {}): TrackerDayData {
  return {
    reportDate: "2026-04-06",
    rules: [],
    auto: {},
    answers: {},
    compliance: {
      date: "2026-04-06",
      applicable: 0,
      satisfied: 0,
      pct: null,
      status: "skipped",
      missedRuleIds: [],
      unansweredRuleIds: [],
    },
    currency: "USD",
    tradeLabels: {},
    locked: false,
    ...over,
  };
}

beforeEach(() => setCheckinMock.mockReset().mockResolvedValue({ ok: true }));

describe("a locked day removes the control, not just disables it", () => {
  const R = [rule({ id: "r1", text: "Only trade my defined hours" })];

  it("locked: shows a read-only Lock badge, no clickable check/no buttons at all", () => {
    render(
      <TrackerStageSection
        stage="prepare"
        data={data({ rules: R, answers: { r1: true }, locked: true })}
      />,
    );
    expect(screen.getByText("met")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Met" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Not met" })).not.toBeInTheDocument();
  });

  it("unlocked: the same rule offers real, clickable answer buttons", () => {
    render(
      <TrackerStageSection
        stage="prepare"
        data={data({ rules: R, answers: {}, locked: false })}
      />,
    );
    expect(screen.getByRole("button", { name: "Met" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Not met" })).toBeEnabled();
  });

  it("clicking Met while unlocked actually saves, and clicking it again clears the answer", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <TrackerStageSection
        stage="prepare"
        data={data({ rules: R, answers: {}, locked: false })}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Met" }));
    expect(setCheckinMock).toHaveBeenCalledWith("r1", "2026-04-06", true);

    await user.click(screen.getByRole("button", { name: "Met" }));
    expect(setCheckinMock).toHaveBeenCalledWith("r1", "2026-04-06", null);
  });

  it("a failed save reverts the optimistic answer and surfaces the error", async () => {
    setCheckinMock.mockResolvedValue({ ok: false, error: "network failed" });
    const user = userEvent.setup({ delay: null });
    render(
      <TrackerStageSection
        stage="prepare"
        data={data({ rules: R, answers: {}, locked: false })}
      />,
    );
    const btn = screen.getByRole("button", { name: "Met" });
    await user.click(btn);
    // The optimistic press reverts once the server action reports failure —
    // an answer that LOOKS saved but was actually rejected is worse than a
    // slow save, because the reader has no reason to look again.
    await vi.waitFor(() => expect(btn).toHaveAttribute("aria-pressed", "false"));
  });
});

describe("a rule not live on this stage is simply absent, not disabled", () => {
  it("renders nothing when no rule applies to this stage", () => {
    const { container } = render(
      <TrackerStageSection
        stage="reflect"
        data={data({ rules: [rule({ id: "r1", text: "x", stage: "prepare" })] })}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("auto rules show a verdict but never a manual control", () => {
  it("a violated money rule shows the observed amount against its limit", () => {
    const R = [
      rule({
        id: "r1",
        text: "Max loss per trade",
        auto_key: "max_loss_per_trade",
        config: { amount: 500 },
      }),
    ];
    render(
      <TrackerStageSection
        stage="prepare"
        data={data({
          rules: R,
          auto: {
            max_loss_per_trade: {
              key: "max_loss_per_trade",
              verdict: "fail",
              reason: "violated",
              observed: -620,
              offenders: ["trade-1"],
            },
          },
          tradeLabels: { "trade-1": "#12 EURUSD" },
        })}
      />,
    );
    expect(screen.getByText("broken")).toBeInTheDocument();
    expect(screen.getByText(/-\$620\.00.*-\$500\.00/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "#12 EURUSD" })).toHaveAttribute(
      "href",
      "/trades/trade-1/edit",
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("an unconfigured auto rule says so instead of silently reading as passed", () => {
    const R = [rule({ id: "r1", text: "Max loss per trade", auto_key: "max_loss_per_trade" })];
    render(
      <TrackerStageSection
        stage="prepare"
        data={data({
          rules: R,
          auto: {
            max_loss_per_trade: {
              key: "max_loss_per_trade",
              verdict: "na",
              reason: "unconfigured",
              observed: null,
              offenders: [],
            },
          },
        })}
      />,
    );
    expect(screen.getByText("not scored")).toBeInTheDocument();
    expect(screen.getByText(/No limit set/)).toBeInTheDocument();
  });
});
