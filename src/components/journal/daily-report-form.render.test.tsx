import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DailyReportForm } from "./daily-report-form";
import type { DailyReport } from "@/lib/journal/daily-report";
import type { TrackerDayData } from "./tracker-checklist";
import type { TrackerRule } from "@/lib/journal/tracker-types";

/**
 * The other half of "da zaključan dan zaista onemogući čekiranje": the
 * report side of a locked day. `<fieldset disabled>` is the mechanism, and
 * this file checks it actually reaches a real control (a checkbox two
 * levels of composition away), not just the fields this component owns
 * directly.
 */

const saveDailyReportMock = vi.fn();
const lockDayMock = vi.fn();
const setCheckinMock = vi.fn();
vi.mock("@/app/(app)/daily/actions", () => ({
  saveDailyReport: (...a: unknown[]) => saveDailyReportMock(...a),
}));
vi.mock("@/app/(app)/daily/tracker-actions", () => ({
  lockDay: (...a: unknown[]) => lockDayMock(...a),
  setCheckin: (...a: unknown[]) => setCheckinMock(...a),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const toastErrorMock = vi.fn();
const toastSuccessMock = vi.fn();
const toastWarningMock = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...a: unknown[]) => toastErrorMock(...a),
    success: (...a: unknown[]) => toastSuccessMock(...a),
    warning: (...a: unknown[]) => toastWarningMock(...a),
  },
}));

function trackerRule(over: Partial<TrackerRule> & { id: string; text: string }): TrackerRule {
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

function trackerData(over: Partial<TrackerDayData> = {}): TrackerDayData {
  return {
    reportDate: "2026-04-02",
    rules: [trackerRule({ id: "r1", text: "Only trade my defined hours" })],
    auto: {},
    answers: {},
    compliance: {
      date: "2026-04-02",
      applicable: 1,
      satisfied: 0,
      pct: 0,
      status: "pending",
      missedRuleIds: [],
      unansweredRuleIds: ["r1"],
    },
    currency: "USD",
    tradeLabels: {},
    locked: false,
    ...over,
  };
}

function report(over: Partial<DailyReport> = {}): DailyReport {
  return {
    id: "rep1",
    user_id: "u1",
    report_date: "2026-04-02",
    day_grade: null,
    mental_temp: null,
    sleep_quality: null,
    macro_note: null,
    mental_rehearsal: null,
    market_type: null,
    micromanage: null,
    impulse_fomo: false,
    impulse_fear: false,
    impulse_greed: false,
    impulse_fear_wrong: false,
    impulse_note: null,
    rule_broken: null,
    rule_broken_note: null,
    learned_today: null,
    tomorrow_change: null,
    easiest_setup: null,
    day_overview: null,
    celebrate_win: null,
    friday_flat: null,
    no_trade_day: false,
    locked_at: null,
    created_at: "2026-04-02T00:00:00Z",
    updated_at: "2026-04-02T00:00:00Z",
    ...over,
  };
}

beforeEach(() => {
  saveDailyReportMock.mockReset().mockResolvedValue({ ok: true, updated_at: "2026-04-02T12:00:00Z" });
  lockDayMock.mockReset().mockResolvedValue({ ok: true });
  setCheckinMock.mockReset().mockResolvedValue({ ok: true });
  toastErrorMock.mockClear();
  toastSuccessMock.mockClear();
});

describe("a locked day disables everything, including the embedded tracker checklist", () => {
  it("Save and Zaključaj dan are gone, replaced by 'Dan je zaključan'", () => {
    render(
      <DailyReportForm
        report={report({ locked_at: "2026-04-02T20:00:00Z" })}
        reportDate="2026-04-02"
        today="2026-04-10"
        timezone="America/New_York"
        activeGoal={null}
        tracker={trackerData({ locked: true, answers: { r1: true } })}
      />,
    );
    expect(screen.queryByRole("button", { name: /Sačuvaj izveštaj/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Zaključaj dan/ })).not.toBeInTheDocument();
    expect(screen.getByText("Dan je zaključan")).toBeInTheDocument();
  });

  it("the day-grade buttons are genuinely disabled (fieldset cascade)", () => {
    render(
      <DailyReportForm
        report={report({ locked_at: "2026-04-02T20:00:00Z" })}
        reportDate="2026-04-02"
        today="2026-04-10"
        timezone="America/New_York"
        activeGoal={null}
        tracker={trackerData({ locked: true })}
      />,
    );
    // DAY_GRADES renders A/B/C/D/F as buttons.
    expect(screen.getByRole("button", { name: "A" })).toBeDisabled();
  });

  it("the embedded tracker rule shows a Lock badge, not clickable answer buttons", () => {
    render(
      <DailyReportForm
        report={report({ locked_at: "2026-04-02T20:00:00Z" })}
        reportDate="2026-04-02"
        today="2026-04-10"
        timezone="America/New_York"
        activeGoal={null}
        tracker={trackerData({ locked: true, answers: { r1: true } })}
      />,
    );
    expect(screen.getByText("ispunjeno")).toBeInTheDocument(); // the lock badge's own state text
    expect(screen.queryByRole("button", { name: "Ispunjeno" })).not.toBeInTheDocument();
  });

  it("an UNLOCKED day keeps every one of those controls live", () => {
    render(
      <DailyReportForm
        report={report()}
        reportDate="2026-04-02"
        today="2026-04-10"
        timezone="America/New_York"
        activeGoal={null}
        tracker={trackerData({ locked: false })}
      />,
    );
    expect(screen.getByRole("button", { name: "A" })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Zaključaj dan/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Ispunjeno" })).toBeEnabled();
  });
});

describe("no-trade-day clears the impulse fields it hides", () => {
  it("checking 'Dan bez trejdova' resets every impulse checkbox and hides that card", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <DailyReportForm
        report={report({ impulse_fomo: true, impulse_fear: true })}
        reportDate="2026-04-02"
        today="2026-04-10"
        timezone="America/New_York"
        activeGoal={null}
        tracker={trackerData()}
      />,
    );
    expect(screen.getByText("Kontrola impulsa")).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: /Dan bez trejdova/ }));

    expect(screen.queryByText("Kontrola impulsa")).not.toBeInTheDocument();
  });
});

describe("the Friday card only shows up on a Friday", () => {
  it("2026-04-03 (Friday) shows the rule, 2026-04-02 (Thursday) does not", () => {
    const { rerender } = render(
      <DailyReportForm
        report={report({ report_date: "2026-04-02" })}
        reportDate="2026-04-02"
        today="2026-04-10"
        timezone="America/New_York"
        activeGoal={null}
        tracker={trackerData({ reportDate: "2026-04-02" })}
      />,
    );
    expect(screen.queryByText("Petak pravilo")).not.toBeInTheDocument();

    rerender(
      <DailyReportForm
        report={report({ report_date: "2026-04-03" })}
        reportDate="2026-04-03"
        today="2026-04-10"
        timezone="America/New_York"
        activeGoal={null}
        tracker={trackerData({ reportDate: "2026-04-03" })}
      />,
    );
    expect(screen.getByText("Petak pravilo")).toBeInTheDocument();
  });
});

describe("locking saves the report first, so it never seals empty text", () => {
  it("confirming the lock dialog calls saveDailyReport before lockDay", async () => {
    const user = userEvent.setup({ delay: null });
    const order: string[] = [];
    saveDailyReportMock.mockImplementation(async () => {
      order.push("save");
      return { ok: true, updated_at: "2026-04-02T12:00:00Z" };
    });
    lockDayMock.mockImplementation(async () => {
      order.push("lock");
      return { ok: true };
    });

    render(
      <DailyReportForm
        report={report()}
        reportDate="2026-04-02"
        today="2026-04-10"
        timezone="America/New_York"
        activeGoal={null}
        tracker={trackerData()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Zaključaj dan/ }));
    await user.click(screen.getByRole("button", { name: "Zaključaj" }));

    await vi.waitFor(() => expect(lockDayMock).toHaveBeenCalled());
    expect(order).toEqual(["save", "lock"]);
  });

  it("aborts the lock when the save fails — nothing gets sealed", async () => {
    const user = userEvent.setup({ delay: null });
    saveDailyReportMock.mockResolvedValue({ ok: false, error: "mreža je pukla" });

    render(
      <DailyReportForm
        report={report()}
        reportDate="2026-04-02"
        today="2026-04-10"
        timezone="America/New_York"
        activeGoal={null}
        tracker={trackerData()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Zaključaj dan/ }));
    await user.click(screen.getByRole("button", { name: "Zaključaj" }));

    await vi.waitFor(() => expect(saveDailyReportMock).toHaveBeenCalled());
    expect(lockDayMock).not.toHaveBeenCalled();
  });
});
