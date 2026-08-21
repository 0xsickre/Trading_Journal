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
    checkedPositions: 6,
    interferedPositions: 2,
    thesisSlippedPositions: 1,
    // Consistent with the counts above by construction: 3 of 4 decided = 75 %.
    // A fixture whose ratio contradicted its own wins/losses would let the card
    // print an impossible pair and still pass.
    winRate: 75,
    profitFactor: 2.4,
    avgR: 0.9,
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
    expect(screen.getByText("5 / 7")).toBeInTheDocument(); // journalled days
    expect(screen.getByText("3 / 1")).toBeInTheDocument(); // won / lost
    expect(screen.getByText("Touched")).toBeInTheDocument();
    expect(screen.getByText("Thesis slipped")).toBeInTheDocument();
  });

  it("names the week by its range, not by a raw key", () => {
    render(form());
    expect(screen.getByText("5–11 Jan 2026")).toBeInTheDocument();
  });
});

describe("a week that is still running", () => {
  it("cannot be sealed, and says why", () => {
    render(form({ weekStart: THIS }));
    expect(screen.queryByRole("button", { name: /Lock week/ })).not.toBeInTheDocument();
    expect(screen.getByText(/This week is not over/)).toBeInTheDocument();
    // Still writable — notes taken during the week are not the problem; a
    // permanent seal over a moving week is.
    expect(screen.getByRole("button", { name: /Save review/ })).toBeEnabled();
  });

  it("a finished week can be sealed", () => {
    render(form());
    expect(screen.getByRole("button", { name: /Lock week/ })).toBeEnabled();
  });
});

describe("Complete means the grade plus both singular answers", () => {
  it("reads Draft until all three are given", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      form({
        review: review({
          one_pattern: "Held two losers past the time stop",
          one_change: "Close anything past its time stop on sight",
        }),
      }),
    );
    expect(screen.getByText("Draft")).toBeInTheDocument();

    // Zvezdice nose `role="radio"` i ime „N of 5" — ocena je izbor iz skupa,
    // ne pet nezavisnih dugmadi.
    await user.click(screen.getByRole("radio", { name: "4 of 5" }));

    expect(screen.getByText("Complete")).toBeInTheDocument();
  });
});

describe("a locked week", () => {
  it("hides Save and Lock, and disables the rating stars", () => {
    render(form({ review: review({ locked_at: "2026-01-12T20:00:00Z" }) }));
    expect(screen.queryByRole("button", { name: /Save review/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Lock week/ })).not.toBeInTheDocument();
    expect(screen.getByText("Week is locked")).toBeInTheDocument();
    // Onemogućava ih `<fieldset disabled>` oko cele forme, ne prop na
    // komponenti — zato ovo i dalje važi posle prelaska na zvezdice.
    expect(screen.getByRole("radio", { name: "5 of 5" })).toBeDisabled();
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
    await user.click(screen.getByRole("button", { name: /Lock week/ }));
    await user.click(screen.getByRole("button", { name: "Lock" }));

    await vi.waitFor(() => expect(lockWeekMock).toHaveBeenCalled());
    expect(order).toEqual(["save", "lock"]);
  });

  it("aborts the lock when the save fails — nothing gets sealed", async () => {
    const user = userEvent.setup({ delay: null });
    saveWeeklyReviewMock.mockResolvedValue({ ok: false, error: "network failed" });

    render(form());
    await user.click(screen.getByRole("button", { name: /Lock week/ }));
    await user.click(screen.getByRole("button", { name: "Lock" }));

    await vi.waitFor(() => expect(saveWeeklyReviewMock).toHaveBeenCalled());
    expect(lockWeekMock).not.toHaveBeenCalled();
  });
});
