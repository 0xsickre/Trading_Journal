import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WeeklyReviewForm } from "./weekly-review-form";
import type { WeeklyReview } from "@/lib/journal/weekly-review";
import type { WeekRecap } from "@/lib/journal/week-recap";
import type { PeriodRow } from "@/lib/journal/period-stats";

/**
 * Two things this file exists to pin, both of which are silent when broken:
 * that a week still running cannot be sealed, and that locking saves first so
 * it never seals text the user has typed but not stored.
 */

const saveWeeklyReviewMock = vi.fn();
const lockWeekMock = vi.fn();
vi.mock("@/app/(app)/weekly/actions", () => ({
  saveWeeklyReview: (...a: unknown[]) => saveWeeklyReviewMock(...a),
  lockWeek: (...a: unknown[]) => lockWeekMock(...a),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const toastErrorMock = vi.fn();
const toastSuccessMock = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...a: unknown[]) => toastErrorMock(...a),
    success: (...a: unknown[]) => toastSuccessMock(...a),
    warning: vi.fn(),
  },
}));

// 2026-01-05 Mon; the "current" week in these tests starts 2026-01-12.
const LAST = "2026-01-05";
const THIS = "2026-01-12";

function review(over: Partial<WeeklyReview> = {}): WeeklyReview {
  return {
    id: "w1",
    user_id: "u1",
    week_start: LAST,
    week_grade: null,
    went_well: null,
    went_badly: null,
    one_pattern: null,
    one_change: null,
    next_week_catalysts: null,
    // Present and null, as a row reads once the migration is applied. A row
    // WITHOUT the key is the pre-migration shape, and its own test below.
    previous_change_kept: null,
    locked_at: null,
    created_at: "2026-01-12T00:00:00Z",
    updated_at: "2026-01-12T00:00:00Z",
    ...over,
  };
}

function recap(over: Partial<WeekRecap> = {}): WeekRecap {
  return {
    closed: 4,
    net: 820,
    wins: 3,
    losses: 1,
    weekendHolds: 1,
    journalledDays: 5,
    journalledOutOf: 5,
    checkedPositions: 6,
    interferedPositions: 2,
    thesisSlippedPositions: 1,
    // Consistent with the counts above by construction: 3 of 4 decided = 75 %.
    // A fixture whose ratio contradicted its own wins/losses would let the card
    // print an impossible pair and still pass.
    winRate: 75,
    profitFactor: 2.4,
    avgR: 0.9,
    rSample: 4,
    expectancy: 0.9,
    expectancySample: 4,
    ...over,
  };
}

/** A week that traded Mon–Wed and sat out the rest — seven entries, four null. */
const DAYS: (PeriodRow | null)[] = [
  { key: "2026-01-05", net: 400, trades: 2 } as PeriodRow,
  { key: "2026-01-06", net: -120, trades: 1 } as PeriodRow,
  { key: "2026-01-07", net: 540, trades: 1 } as PeriodRow,
  null,
  null,
  null,
  null,
];

function form(props: Partial<Parameters<typeof WeeklyReviewForm>[0]> = {}) {
  return (
    <WeeklyReviewForm
      review={review()}
      weekStart={LAST}
      currentWeekStart={THIS}
      recap={recap()}
      days={DAYS}
      currency="USD"
      {...props}
    />
  );
}

beforeEach(() => {
  saveWeeklyReviewMock
    .mockReset()
    .mockResolvedValue({ ok: true, updated_at: "2026-01-12T12:00:00Z" });
  lockWeekMock.mockReset().mockResolvedValue({ ok: true });
  toastErrorMock.mockClear();
  toastSuccessMock.mockClear();
});

describe("the facts come before the questions", () => {
  it("shows the week's counts, so the review is not written from memory", () => {
    render(form());
    expect(screen.getByText("5 / 5")).toBeInTheDocument(); // journalled days, Mon–Fri
    expect(screen.getByText("3 / 1")).toBeInTheDocument(); // won / lost
    expect(screen.getByText("Dirano")).toBeInTheDocument();
    expect(screen.getByText("Teza oslabila")).toBeInTheDocument();
  });

  it("names the week by its range, not by a raw key", () => {
    render(form());
    expect(screen.getByText("5–11. jan 2026.")).toBeInTheDocument();
  });
});

describe("a week that is still running", () => {
  it("cannot be sealed, and says why", () => {
    render(form({ weekStart: THIS }));
    expect(screen.queryByRole("button", { name: /Zaključaj nedelju/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Ova nedelja nije završena/)).toBeInTheDocument();
    // Still writable — notes taken during the week are not the problem; a
    // permanent seal over a moving week is.
    expect(screen.getByRole("button", { name: /Sačuvaj osvrt/ })).toBeEnabled();
  });

  it("a finished week can be sealed", () => {
    render(form());
    expect(screen.getByRole("button", { name: /Zaključaj nedelju/ })).toBeEnabled();
  });
});

describe("Complete means the grade plus both singular answers", () => {
  it("reads Draft until all three are STORED, not merely typed", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      form({
        review: review({
          one_pattern: "Held two losers past the time stop",
          one_change: "Close anything past its time stop on sight",
        }),
      }),
    );
    expect(screen.getByText("Nacrt")).toBeInTheDocument();

    // The stars carry `role="radio"` and the name "N od 5" — a rating is a choice
    // out of a set, not five independent buttons.
    await user.click(screen.getByRole("radio", { name: "4 od 5" }));

    // Still a draft: the grade is on screen and not in the database. The save
    // bar is where the live state belongs, and it now says so.
    expect(screen.getByText("Nacrt")).toBeInTheDocument();
    expect(screen.getByText("Nesačuvane izmene")).toBeInTheDocument();
  });

  it("reads Complete when the stored review already has all three", () => {
    render(
      form({
        review: review({
          week_grade: 4,
          one_pattern: "Held two losers past the time stop",
          one_change: "Close anything past its time stop on sight",
        }),
      }),
    );
    expect(screen.getByText("Završeno")).toBeInTheDocument();
  });
});

describe("a locked week", () => {
  it("hides Save and Lock, and disables the rating stars", () => {
    render(form({ review: review({ locked_at: "2026-01-12T20:00:00Z" }) }));
    expect(screen.queryByRole("button", { name: /Sačuvaj osvrt/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Zaključaj nedelju/ })).not.toBeInTheDocument();
    expect(screen.getByText("Nedelja je zaključana")).toBeInTheDocument();
    // They are disabled by the `<fieldset disabled>` around the whole form, not
    // by a prop on the component — which is why this still holds after the move
    // to stars.
    expect(screen.getByRole("radio", { name: "5 od 5" })).toBeDisabled();
  });
});

describe("locking saves first, so it never seals unsaved text", () => {
  it("confirming the dialog calls saveWeeklyReview before lockWeek", async () => {
    const user = userEvent.setup({ delay: null });
    const order: string[] = [];
    saveWeeklyReviewMock.mockImplementation(async () => {
      order.push("save");
      return { ok: true, updated_at: "2026-01-12T12:00:00Z" };
    });
    lockWeekMock.mockImplementation(async () => {
      order.push("lock");
      return { ok: true };
    });

    render(form());
    await user.click(screen.getByRole("button", { name: /Zaključaj nedelju/ }));
    await user.click(screen.getByRole("button", { name: "Zaključaj" }));

    await vi.waitFor(() => expect(lockWeekMock).toHaveBeenCalled());
    expect(order).toEqual(["save", "lock"]);
  });

  it("aborts the lock when the save fails — nothing gets sealed", async () => {
    const user = userEvent.setup({ delay: null });
    saveWeeklyReviewMock.mockResolvedValue({ ok: false, error: "network failed" });

    render(form());
    await user.click(screen.getByRole("button", { name: /Zaključaj nedelju/ }));
    await user.click(screen.getByRole("button", { name: "Zaključaj" }));

    await vi.waitFor(() => expect(saveWeeklyReviewMock).toHaveBeenCalled());
    expect(lockWeekMock).not.toHaveBeenCalled();
  });
});

describe("unsaved answers survive the week arrows", () => {
  it("asks before leaving, and stays put when the answer is no", async () => {
    const user = userEvent.setup({ delay: null });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(form());

    await user.type(screen.getByLabelText("Šta je išlo dobro"), "Waited for the sweep");
    await user.click(screen.getByRole("link", { name: "Prethodna nedelja" }));

    expect(confirm).toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("offers a draft left behind for this week, and restores it on request", async () => {
    const user = userEvent.setup({ delay: null });
    localStorage.setItem(
      "tj:weekly-draft",
      JSON.stringify({
        [LAST]: {
          savedAt: "2026-01-12T09:30:00Z",
          fields: {
            week_grade: null,
            went_well: "Sat on my hands Monday",
            went_badly: "",
            one_pattern: "",
            one_change: "",
            next_week_catalysts: "",
          },
        },
      }),
    );

    render(form());
    expect(await screen.findByText(/Imaš nesačuvan nacrt/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Vrati nacrt" }));
    expect(screen.getByLabelText("Šta je išlo dobro")).toHaveValue("Sat on my hands Monday");
    localStorage.clear();
  });

  it("never offers a draft that only repeats what is already saved", () => {
    localStorage.setItem(
      "tj:weekly-draft",
      JSON.stringify({
        [LAST]: {
          savedAt: "2026-01-12T09:30:00Z",
          fields: {
            week_grade: null,
            went_well: "Already stored",
            went_badly: "",
            one_pattern: "",
            one_change: "",
            next_week_catalysts: "",
          },
        },
      }),
    );
    render(form({ review: review({ went_well: "Already stored" }) }));
    expect(screen.queryByText(/Imaš nesačuvan nacrt/)).not.toBeInTheDocument();
    localStorage.clear();
  });
});

describe("the week arrows", () => {
  it("the next arrow on the newest week is a disabled button, not a link", () => {
    render(form({ weekStart: THIS }));
    const next = screen.getByRole("button", { name: "Sledeća nedelja" });
    expect(next).toBeDisabled();
    expect(screen.queryByRole("link", { name: "Sledeća nedelja" })).not.toBeInTheDocument();
  });

  it("the back arrow stops at the oldest week there is anything to see", () => {
    render(form({ earliestWeekStart: LAST }));
    expect(screen.getByRole("button", { name: "Prethodna nedelja" })).toBeDisabled();
  });
});

describe("last week's commitment", () => {
  it("opens the week with what was promised, and asks whether it held", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      form({
        previousReview: review({
          week_start: "2025-12-29",
          one_change: "No entry before the London sweep",
          next_week_catalysts: "CPI on Wednesday",
          previous_change_kept: null,
        }),
      }),
    );
    expect(screen.getByText("No entry before the London sweep")).toBeInTheDocument();
    expect(screen.getByText(/CPI on Wednesday/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delimično" }));
    await user.click(screen.getByRole("button", { name: /Sačuvaj osvrt/ }));
    await vi.waitFor(() =>
      expect(saveWeeklyReviewMock).toHaveBeenCalledWith(
        LAST,
        expect.objectContaining({ previous_change_kept: "partly" }),
      ),
    );
  });

  it("hides the follow-up while the database has no column for the answer", () => {
    const noColumn = review();
    delete (noColumn as { previous_change_kept?: unknown }).previous_change_kept;
    render(
      form({
        review: noColumn,
        previousReview: review({ week_start: "2025-12-29", one_change: "No entry before the sweep" }),
      }),
    );
    expect(screen.getByText("No entry before the sweep")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delimično" })).not.toBeInTheDocument();
  });

  it("says nothing when last week left no commitment", () => {
    render(form({ previousReview: null }));
    expect(screen.queryByText("Prošle nedelje si rekao")).not.toBeInTheDocument();
  });
});

describe("a week with nothing in it", () => {
  it("says so once instead of printing a grid of zeros", () => {
    render(
      form({
        recap: recap({
          closed: 0,
          net: 0,
          wins: 0,
          losses: 0,
          weekendHolds: 0,
          journalledDays: 0,
          checkedPositions: 0,
          interferedPositions: 0,
          thesisSlippedPositions: 0,
          winRate: null,
          profitFactor: null,
          avgR: null,
          rSample: 0,
          expectancy: null,
          expectancySample: 0,
        }),
        days: [null, null, null, null, null, null, null],
      }),
    );
    expect(screen.getByText(/nema nijednog zatvorenog trejda/)).toBeInTheDocument();
    expect(screen.queryByText("Dirano")).not.toBeInTheDocument();
  });
});
