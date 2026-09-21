import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DailyReportForm } from "./daily-report-form";
import type { DailyReport } from "@/lib/journal/daily-report";
import type { OpenPositionView } from "./open-positions-card";
import type { TrackerDayData } from "./tracker-checklist";
import type { TrackerRule } from "@/lib/journal/tracker-types";

/**
 * The other half of "a locked day really does refuse answers": the report side.
 * `<fieldset disabled>` is the mechanism, and this file checks it actually
 * reaches a real control two levels of composition away — a tracker checkbox,
 * and now a position check-in button — not just the fields this component owns
 * directly.
 */

const saveDailyReportMock = vi.fn();
const savePositionCheckinMock = vi.fn();
const lockDayMock = vi.fn();
const setCheckinMock = vi.fn();
vi.mock("@/app/(app)/daily/actions", () => ({
  saveDailyReport: (...a: unknown[]) => saveDailyReportMock(...a),
  savePositionCheckin: (...a: unknown[]) => savePositionCheckinMock(...a),
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
    mental_temp: null,
    no_trade_day: false,
    locked_at: null,
    created_at: "2026-04-02T00:00:00Z",
    updated_at: "2026-04-02T00:00:00Z",
    ...over,
  };
}

function position(over: Partial<OpenPositionView> = {}): OpenPositionView {
  return {
    id: "p1",
    label: "#12 XAUUSD",
    daysInTrade: 3,
    timeStopDays: 5,
    pastTimeStop: false,
    thesis: null,
    invalidation: null,
    checkin: null,
    ...over,
  };
}

beforeEach(() => {
  saveDailyReportMock.mockReset().mockResolvedValue({ ok: true, updated_at: "2026-04-02T12:00:00Z" });
  savePositionCheckinMock.mockReset().mockResolvedValue({ ok: true });
  lockDayMock.mockReset().mockResolvedValue({ ok: true });
  setCheckinMock.mockReset().mockResolvedValue({ ok: true });
  toastErrorMock.mockClear();
  toastSuccessMock.mockClear();
});

describe("a locked day disables everything, including the embedded tracker checklist", () => {
  it("Save and Lock day are gone, replaced by 'Day is locked'", () => {
    render(
      <DailyReportForm
        report={report({ locked_at: "2026-04-02T20:00:00Z" })}
        reportDate="2026-04-02"
        today="2026-04-10"
        timezone="America/New_York"
        activeGoal={null}
        positions={[position()]}
        tracker={trackerData({ locked: true, answers: { r1: true } })}
      />,
    );
    expect(screen.queryByRole("button", { name: /Sačuvaj izveštaj/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Zaključaj dan/ })).not.toBeInTheDocument();
    expect(screen.getByText("Dan je zaključan")).toBeInTheDocument();
  });

  it("the position check-in buttons are genuinely disabled", () => {
    render(
      <DailyReportForm
        report={report({ locked_at: "2026-04-02T20:00:00Z" })}
        reportDate="2026-04-02"
        today="2026-04-10"
        timezone="America/New_York"
        activeGoal={null}
        positions={[position()]}
        tracker={trackerData({ locked: true })}
      />,
    );
    // Belt and braces, and deliberately so. These carry their own `disabled`
    // AND sit inside the disabled fieldset — a check-in writes through its own
    // server action rather than the form's Save, so if the fieldset were ever
    // restructured the lock would otherwise leak on this control alone.
    expect(screen.getByRole("button", { name: "Netaknuta" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Pomerio stop" })).toBeDisabled();
  });

  it("the embedded tracker rule shows a Lock badge, not clickable answer buttons", () => {
    render(
      <DailyReportForm
        report={report({ locked_at: "2026-04-02T20:00:00Z" })}
        reportDate="2026-04-02"
        today="2026-04-10"
        timezone="America/New_York"
        activeGoal={null}
        positions={[position()]}
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
        positions={[position()]}
        tracker={trackerData({ locked: false })}
      />,
    );
    expect(screen.getByRole("button", { name: "Netaknuta" })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Zaključaj dan/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Ispunjeno" })).toBeEnabled();
  });
});

describe("no new entry today", () => {
  it("keeps the open positions on screen — holding is a decision too", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <DailyReportForm
        report={report()}
        reportDate="2026-04-02"
        today="2026-04-10"
        timezone="America/New_York"
        activeGoal={null}
        positions={[position()]}
        tracker={trackerData()}
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: /Danas bez novog ulaska/ }));

    // The impulse card it used to hide is gone entirely (Phase E): four
    // checkboxes and a note that nothing ever read.
    expect(screen.queryByText("Kontrola impulsa")).not.toBeInTheDocument();
    // The point of the reworded label. "No new entry" is not "no exposure": a
    // swing book's quietest days are the ones spent holding, and hiding the
    // check-in on them would drop the journal on exactly the days it is the
    // only thing being decided.
    expect(screen.getByText("#12 XAUUSD")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Netaknuta" })).toBeInTheDocument();
  });
});

describe("the daily page asks about positions, not about the day", () => {
  it("shows the hold's age, the time stop, and the thesis off the trade", () => {
    render(
      <DailyReportForm
        report={report()}
        reportDate="2026-04-02"
        today="2026-04-10"
        timezone="America/New_York"
        activeGoal={null}
        positions={[
          position({
            thesis: "Dollar weakness into CPI",
            invalidation: "Daily close back under 2340",
          }),
        ]}
        tracker={trackerData()}
      />,
    );
    expect(screen.getByText(/dan 3 od 5/)).toBeInTheDocument();
    expect(screen.getByText("Dollar weakness into CPI")).toBeInTheDocument();
    expect(screen.getByText("Daily close back under 2340")).toBeInTheDocument();
  });

  it("warns only once the time stop is PAST, not on the day it is reached", () => {
    const { rerender } = render(
      <DailyReportForm
        report={report()}
        reportDate="2026-04-02"
        today="2026-04-10"
        timezone="America/New_York"
        activeGoal={null}
        positions={[position({ daysInTrade: 5, pastTimeStop: false })]}
        tracker={trackerData()}
      />,
    );
    expect(screen.queryByText("Prošao time stop")).not.toBeInTheDocument();

    rerender(
      <DailyReportForm
        report={report()}
        reportDate="2026-04-02"
        today="2026-04-10"
        timezone="America/New_York"
        activeGoal={null}
        positions={[position({ daysInTrade: 6, pastTimeStop: true })]}
        tracker={trackerData()}
      />,
    );
    expect(screen.getByText("Prošao time stop")).toBeInTheDocument();
  });

  it("saves a check-in the moment it is answered, without pressing Save", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <DailyReportForm
        report={report()}
        reportDate="2026-04-02"
        today="2026-04-10"
        timezone="America/New_York"
        activeGoal={null}
        positions={[position()]}
        tracker={trackerData()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Oslabljena" }));

    await vi.waitFor(() => expect(savePositionCheckinMock).toHaveBeenCalled());
    expect(savePositionCheckinMock).toHaveBeenCalledWith("2026-04-02", {
      position_id: "p1",
      thesis_state: "weakened",
      touched: null,
      note: null,
    });
    // The report itself is untouched: three taps are worth persisting on their
    // own, and a check-in must not depend on the form's Save button.
    expect(saveDailyReportMock).not.toHaveBeenCalled();
  });

  it("sends the WHOLE row, so answering one question does not blank the other", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <DailyReportForm
        report={report()}
        reportDate="2026-04-02"
        today="2026-04-10"
        timezone="America/New_York"
        activeGoal={null}
        positions={[
          position({
            checkin: {
              id: "c1",
              position_id: "p1",
              report_date: "2026-04-02",
              thesis_state: "intact",
              touched: null,
              note: null,
            },
          }),
        ]}
        tracker={trackerData()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Pomerio stop" }));

    await vi.waitFor(() => expect(savePositionCheckinMock).toHaveBeenCalled());
    // The upsert writes all three columns. A patch-shaped payload would clear
    // the thesis answer given a moment earlier.
    expect(savePositionCheckinMock).toHaveBeenCalledWith("2026-04-02", {
      position_id: "p1",
      thesis_state: "intact",
      touched: "stop_moved",
      note: null,
    });
  });

  it("says so plainly when nothing was open", () => {
    render(
      <DailyReportForm
        report={report()}
        reportDate="2026-04-02"
        today="2026-04-10"
        timezone="America/New_York"
        activeGoal={null}
        positions={[]}
        tracker={trackerData()}
      />,
    );
    expect(screen.getByText(/Ništa nije bilo otvoreno ovog dana/)).toBeInTheDocument();
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
        positions={[position()]}
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
    saveDailyReportMock.mockResolvedValue({ ok: false, error: "network failed" });

    render(
      <DailyReportForm
        report={report()}
        reportDate="2026-04-02"
        today="2026-04-10"
        timezone="America/New_York"
        activeGoal={null}
        positions={[position()]}
        tracker={trackerData()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Zaključaj dan/ }));
    await user.click(screen.getByRole("button", { name: "Zaključaj" }));

    await vi.waitFor(() => expect(saveDailyReportMock).toHaveBeenCalled());
    expect(lockDayMock).not.toHaveBeenCalled();
  });
});

describe("moving between days", () => {
  const drawOn = (reportDate: string, today: string) =>
    render(
      <DailyReportForm
        report={report()}
        reportDate={reportDate}
        today={today}
        timezone="America/New_York"
        activeGoal={null}
        positions={[]}
        tracker={trackerData()}
      />,
    );

  it("on today, 'next day' is a disabled button, not a link back to the same day", () => {
    drawOn("2026-04-02", "2026-04-02");
    const next = screen.getByLabelText("Sledeći dan");
    expect(next.tagName).toBe("BUTTON");
    expect(next).toBeDisabled();
  });

  it("asks before leaving a day with an unsaved answer, and stays if told to", async () => {
    // The form remounts per day: without this, an answer given vanished on an
    // arrow. Any field will do — since Phase E the day has two of them, so
    // this uses the checkbox rather than the prose that used to be here.
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    drawOn("2026-04-02", "2026-04-10");
    fireEvent.click(screen.getByRole("checkbox", { name: /Danas bez novog ulaska/ }));

    const prev = screen.getByLabelText("Prethodni dan");
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    prev.dispatchEvent(click);

    expect(confirmSpy).toHaveBeenCalled();
    expect(click.defaultPrevented).toBe(true);
    expect(screen.getByText(/Nesačuvane izmene/)).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it("does not ask when nothing was typed", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    drawOn("2026-04-02", "2026-04-10");
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    screen.getByLabelText("Prethodni dan").dispatchEvent(click);
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
