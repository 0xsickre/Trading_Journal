import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TrackerStageSection, type TrackerDayData } from "./tracker-checklist";
import type { TrackerRule } from "@/lib/journal/tracker-types";

/**
 * "da zaključan dan zaista onemogući čekiranje" — the plan's own stated goal
 * for this step. `locked` has to remove the interactive control entirely,
 * not just disable it, because a disabled-but-present button is a UI promise
 * the day can still be checked that the database will then refuse.
 */

/**
 * Returns what the real action returns, and that is not pedantry.
 *
 * A bare `vi.fn()` answers `undefined`, and the component does
 * `const res = await setCheckin(...); if (!res.ok)` — so every click threw a
 * TypeError inside the `useTransition` callback. The assertions still passed,
 * because they only ask whether the mock was CALLED and the call happens before
 * the throw. What never ran was everything after it: no `router.refresh()`, no
 * rollback on failure, and the transition ending through a rejection instead of
 * normally.
 *
 * So the test claiming "clicking Met actually saves" was in fact exercising a
 * crash, and the timing of that crash — not the component — decided when
 * `pending` cleared and the buttons came back. That is the kind of setup whose
 * behaviour changes under load.
 */
type SetCheckinResult = { ok: true } | { ok: false; error: string };

const setCheckinMock = vi.fn<
  (
    ruleId: string,
    reportDate: string,
    checked: boolean | null,
  ) => Promise<SetCheckinResult>
>(async () => ({ ok: true }));

vi.mock("@/app/(app)/daily/tracker-actions", () => ({
  setCheckin: (...a: Parameters<typeof setCheckinMock>) => setCheckinMock(...a),
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
    expect(screen.getByText("ispunjeno")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ispunjeno" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Nije ispunjeno" })).not.toBeInTheDocument();
  });

  it("unlocked: the same rule offers real, clickable answer buttons", () => {
    render(
      <TrackerStageSection
        stage="prepare"
        data={data({ rules: R, answers: {}, locked: false })}
      />,
    );
    expect(screen.getByRole("button", { name: "Ispunjeno" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Nije ispunjeno" })).toBeEnabled();
  });

  it("clicking Met while unlocked actually saves, and clicking it again clears the answer", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <TrackerStageSection
        stage="prepare"
        data={data({ rules: R, answers: {}, locked: false })}
      />,
    );
    const met = () => screen.getByRole("button", { name: "Ispunjeno" });

    await user.click(met());
    expect(setCheckinMock).toHaveBeenCalledWith("r1", "2026-04-06", true);

    // The control disables itself while the save is in flight, and userEvent
    // does NOTHING to a disabled button — silently, without an error. Clicking
    // again before the transition settles therefore lands on a dead control,
    // and the assertion below fails reporting a toggle bug that is really a
    // timing one. Waiting for the button to come back is also what a person
    // does, so the test now describes the same sequence they would perform.
    await waitFor(() => expect(met()).toBeEnabled());

    await user.click(met());
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
    const btn = screen.getByRole("button", { name: "Ispunjeno" });
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
    expect(screen.getByText("prekršeno")).toBeInTheDocument();
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
    expect(screen.getByText("nije ocenjeno")).toBeInTheDocument();
    expect(screen.getByText(/Limit nije podešen/)).toBeInTheDocument();
  });
});

describe("each stage names itself", () => {
  /**
   * The heading used to be chosen by a `title` prop that ALSO chose the card
   * wrapper, so the two stages rendered bare both fell through to a hardcoded
   * "Process checklist" — one string over `prepare` and the same string again
   * over `reflect`, on one page, naming neither.
   */
  const ofStage = (stage: TrackerRule["stage"]) =>
    data({ rules: [rule({ id: `r-${stage}`, text: `Rule for ${stage}`, stage })] });

  it.each([
    ["prepare", "Priprema"],
    ["trade", "Trgovanje"],
    ["reflect", "Osvrt"],
  ] as const)("labels the %s stage %s", (stage, heading) => {
    render(<TrackerStageSection stage={stage} data={ofStage(stage)} />);
    expect(screen.getByText(heading)).toBeInTheDocument();
    expect(screen.queryByText("Process checklist")).not.toBeInTheDocument();
  });

  it("KEEPS THE HEADING WHEN BOXED — the prop picks the wrapper, never the words", () => {
    // The whole point of splitting `title` into `boxed`: a caller can no longer
    // hand one stage another stage's name, or two stages the same name.
    render(<TrackerStageSection stage="trade" data={ofStage("trade")} boxed />);
    expect(screen.getByText("Trgovanje")).toBeInTheDocument();
  });

  it("renders nothing at all for a stage with no rules", () => {
    const { container } = render(
      <TrackerStageSection stage="reflect" data={ofStage("prepare")} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
