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
    sleep_quality_pct: null,
    sleep_hours: null,
    work_shift: null,
    with_child: null,
    state_at: null,
    tomorrow_change: null,
    opportunities: [],
    no_trade_day: false,
    psychology_tags: [],
    locked_at: null,
    mental_temp_at: null,
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
    expect(screen.getByText("1. U kakvom si stanju?")).toBeInTheDocument();
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
    expect(screen.getByText(/nema pravila za štikliranje i dan je ispunjen/)).toBeInTheDocument();
    expect(screen.queryByText("Tokom sesije")).not.toBeInTheDocument();
  });
});

describe("the gate says it was written after the first entry (phase Y)", () => {
  it("shows when the rating came after the day's first entry", () => {
    render(
      <DailyReportForm
        report={report({ report_date: "2026-10-13", mental_temp: 3, mental_temp_at: "2026-10-14T09:15:54Z" })}
        reportDate="2026-10-13"
        today="2026-10-14"
        timezone="Europe/Belgrade"
        tracker={trackerData()}
        firstEntryAt="2026-10-13T07:24:39Z"
      />,
    );
    expect(screen.getByText(/upisano 14\.10\. 11:15, posle prvog ulaza \(09:24\)/)).toBeInTheDocument();
  });

  it("dates the gate by the state on a day that has one (phase G)", () => {
    render(
      <DailyReportForm
        report={report({
          report_date: "2026-10-28",
          sleep_quality_pct: 70,
          state_at: "2026-10-28T14:00:00Z",
          // An earlier rating does not make a late state look on time.
          mental_temp: 4,
          mental_temp_at: "2026-10-28T06:00:00Z",
        })}
        reportDate="2026-10-28"
        today="2026-10-28"
        timezone="Europe/Belgrade"
        tracker={trackerData()}
        firstEntryAt="2026-10-28T13:40:00Z"
      />,
    );
    expect(screen.getByText(/Stanje upisano 28\.10\. 15:00, posle prvog ulaza \(14:40\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Stara mentalna ocena/)).not.toBeInTheDocument();
  });

  it("says nothing when the rating came first", () => {
    render(
      <DailyReportForm
        report={report({ report_date: "2026-10-13", mental_temp: 3, mental_temp_at: "2026-10-13T06:00:00Z" })}
        reportDate="2026-10-13"
        today="2026-10-14"
        timezone="Europe/Belgrade"
        tracker={trackerData()}
        firstEntryAt="2026-10-13T07:24:39Z"
      />,
    );
    expect(screen.queryByText(/posle prvog ulaza/)).not.toBeInTheDocument();
  });
});

describe("phase G: the state before the session, and the close of the day", () => {
  const draw = (over: Partial<DailyReport> = {}, extra: Partial<Parameters<typeof DailyReportForm>[0]> = {}) =>
    render(
      <DailyReportForm
        report={report(over)}
        reportDate="2026-04-02"
        today="2026-04-10"
        timezone="Europe/Belgrade"
        tracker={trackerData()}
        {...extra}
      />,
    );

  it("asks for sleep, shift and child instead of stars, and saves them", async () => {
    const user = userEvent.setup();
    draw();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Kvalitet sna (%)"), "80");
    await user.type(screen.getByLabelText("Sati sna"), "6.5");
    await user.click(screen.getByRole("button", { name: "Druga smena" }));
    await user.click(screen.getByRole("button", { name: "Sa detetom" }));
    await user.click(screen.getByRole("button", { name: /Sačuvaj izveštaj/ }));
    expect(saveDailyReportMock).toHaveBeenCalledWith(
      "2026-04-02",
      expect.objectContaining({ sleep_quality_pct: 80, sleep_hours: 6.5, work_shift: "druga", with_child: true }),
    );
    expect(saveDailyReportMock.mock.calls[0][1]).not.toHaveProperty("mental_temp");
  });

  it("warns for a smaller risk under 80 % sleep or under 7 hours, as typed (trader, 27.10.2026)", async () => {
    const user = userEvent.setup();
    draw();
    expect(screen.queryByText(/Kratka noć/)).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Kvalitet sna (%)"), "85");
    await user.type(screen.getByLabelText("Sati sna"), "6");
    expect(screen.getByText(/Kratka noć: 6 h sna \(ispod 7 h\)\. Danas manji rizik/)).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Sati sna"));
    await user.type(screen.getByLabelText("Sati sna"), "7");
    expect(screen.queryByText(/Kratka noć/)).not.toBeInTheDocument();
  });

  it("warns from a saved state too", () => {
    draw({ sleep_quality_pct: 70 });
    expect(screen.getByText(/Kratka noć: kvalitet sna 70 % \(ispod 80 %\)/)).toBeInTheDocument();
  });

  it("a second click on a chosen shift clears it", async () => {
    const user = userEvent.setup();
    draw({ work_shift: "prva" });
    const prva = screen.getByRole("button", { name: "Prva smena" });
    expect(prva).toHaveAttribute("aria-pressed", "true");
    await user.click(prva);
    expect(prva).toHaveAttribute("aria-pressed", "false");
  });

  it("shows an old day's rating read-only", () => {
    draw({ mental_temp: 2 });
    expect(screen.getByText(/Stara mentalna ocena ovog dana: 2\/5/)).toBeInTheDocument();
  });

  it("opens with the last 'sutra menjam'", () => {
    draw({}, { lastTomorrowChange: { report_date: "2026-04-01", text: "Čekam MSS pre ulaza." } });
    expect(screen.getByText("Danas menjam")).toBeInTheDocument();
    expect(screen.getByText("Čekam MSS pre ulaza.")).toBeInTheDocument();
    const text = document.body.textContent ?? "";
    expect(text.indexOf("Danas menjam")).toBeLessThan(text.indexOf("Pre sesije"));
  });

  it("writes 'sutra menjam' and up to three opportunities, one the easiest; empty rows are dropped", async () => {
    const user = userEvent.setup();
    draw();
    await user.type(screen.getByLabelText("Sutra menjam"), "Bez ulaza pre 15:40.");
    const add = () => user.click(screen.getByRole("button", { name: /Dodaj priliku/ }));
    await add();
    await add();
    await add();
    expect(screen.queryByRole("button", { name: /Dodaj priliku/ })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Prilika 1"), "NY sweep PDL");
    await user.type(screen.getByLabelText("Prilika 2"), "London FVG");
    const easiest = screen.getAllByRole("checkbox", { name: "Najlakša danas" });
    await user.click(easiest[0]);
    await user.click(easiest[1]);
    await user.click(screen.getAllByRole("checkbox", { name: "U playbook-u" })[1]);
    await user.click(screen.getByRole("button", { name: /Sačuvaj izveštaj/ }));
    const sent = saveDailyReportMock.mock.calls[0][1];
    expect(sent.tomorrow_change).toBe("Bez ulaza pre 15:40.");
    expect(sent.opportunities).toEqual([
      { note: "NY sweep PDL", in_playbook: false, could_take: false, easiest: false },
      { note: "London FVG", in_playbook: true, could_take: false, easiest: true },
    ]);
  });

  it("removes an opportunity", async () => {
    const user = userEvent.setup();
    draw({ opportunities: [{ note: "A", in_playbook: true, could_take: true, easiest: true }] });
    expect(screen.getByLabelText("Prilika 1")).toHaveValue("A");
    await user.click(screen.getByRole("button", { name: "Ukloni priliku 1" }));
    expect(screen.queryByLabelText("Prilika 1")).not.toBeInTheDocument();
  });
});
