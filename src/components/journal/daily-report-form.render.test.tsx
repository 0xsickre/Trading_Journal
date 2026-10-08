import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DailyReportForm } from "./daily-report-form";
import type { DailyReport } from "@/lib/journal/daily-report";
import type { TrackerDayData } from "./tracker-checklist";
import type { TrackerRule } from "@/lib/journal/tracker-types";

/**
 * The other half of "a locked day really does refuse answers": the report side.
 * `<fieldset disabled>` is the mechanism, and this file checks it actually
 * reaches a real control two levels of composition away — a tracker checkbox —
 * not just the fields this component owns directly.
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
    mental_temp: null,
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

describe("no check-in per position (H1, 28.09.2026)", () => {
  it("a day trader is flat by the close: /daily has no open-positions card", () => {
    render(
      <DailyReportForm
        report={report()}
        reportDate="2026-04-02"
        today="2026-04-02"
        timezone="America/New_York"
        tracker={trackerData()}
      />,
    );
    expect(screen.queryByText("Otvorene pozicije")).not.toBeInTheDocument();
  });
});

describe("a locked day disables everything, including the embedded tracker checklist", () => {
  it("Save and Lock day are gone, replaced by 'Day is locked'", () => {
    render(
      <DailyReportForm
        report={report({ locked_at: "2026-04-02T20:00:00Z" })}
        reportDate="2026-04-02"
        today="2026-04-10"
        timezone="America/New_York"
        tracker={trackerData({ locked: true, answers: { r1: true } })}
      />,
    );
    expect(screen.queryByRole("button", { name: /Sačuvaj izveštaj/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Zaključaj dan/ })).not.toBeInTheDocument();
    expect(screen.getByText("Dan je zaključan")).toBeInTheDocument();
  });

  it("the embedded tracker rule shows a Lock badge, not clickable answer buttons", () => {
    render(
      <DailyReportForm
        report={report({ locked_at: "2026-04-02T20:00:00Z" })}
        reportDate="2026-04-02"
        today="2026-04-10"
        timezone="America/New_York"
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
        tracker={trackerData({ locked: false })}
      />,
    );
    expect(screen.getByRole("button", { name: /Zaključaj dan/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Ispunjeno" })).toBeEnabled();
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
    fireEvent.click(screen.getByRole("checkbox", { name: /Danas ne trgujem/ }));

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

describe("the day reads in the order it is lived", () => {
  it("before the session, during it, after it — in that order", () => {
    render(
      <DailyReportForm
        report={null}
        reportDate="2026-04-06"
        today="2026-04-06"
        timezone="America/New_York"
        tracker={trackerData()}
        beforeSession={<p>BRIEF</p>}
        afterSession={<p>REVIEW GAPS</p>}
      />,
    );
    const text = document.body.textContent ?? "";
    const at = (s: string) => text.indexOf(s);
    expect(at("Pre sesije")).toBeGreaterThan(-1);
    expect(at("Pre sesije")).toBeLessThan(at("BRIEF"));
    expect(at("BRIEF")).toBeLessThan(at("Pre nego što uđeš"));
    expect(at("Pre nego što uđeš")).toBeLessThan(at("Tokom sesije"));
    expect(at("Tokom sesije")).toBeLessThan(at("Posle sesije"));
    expect(at("Posle sesije")).toBeLessThan(at("REVIEW GAPS"));
  });

  it("asks its two questions as questions, about the day ahead", () => {
    render(
      <DailyReportForm
        report={null}
        reportDate="2026-04-06"
        today="2026-04-06"
        timezone="America/New_York"
        tracker={trackerData()}
      />,
    );
    expect(screen.getByText("1. Kako si danas?")).toBeInTheDocument();
    expect(screen.getByText("2. Da li danas trguješ?")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Danas ne trgujem/ })).toBeInTheDocument();
    // Nothing points at a card that no longer exists, or speaks of the day as past.
    expect(screen.queryByText(/Otvorene pozicije iznad/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Nisam otvorio/)).not.toBeInTheDocument();
  });
});

describe("phase M: the page measures, the mentor judges", () => {
  it("has no focus goal badge and says when the trade rules are off for the day", () => {
    render(
      <DailyReportForm
        report={report({ no_trade_day: true })}
        reportDate="2026-04-02"
        today="2026-04-10"
        timezone="America/New_York"
        tracker={trackerData()}
      />,
    );
    expect(screen.queryByText("Nacrt")).not.toBeInTheDocument();
    expect(screen.queryByText("Završeno")).not.toBeInTheDocument();
    expect(screen.getByText(/ručna pravila trgovanja se ne ocenjuju/)).toBeInTheDocument();
  });
});
