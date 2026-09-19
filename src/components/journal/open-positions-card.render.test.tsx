import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { OpenPositionsCard, type OpenPositionView } from "./open-positions-card";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/app/(app)/daily/actions", () => ({
  savePositionCheckin: vi.fn(async () => ({ ok: true as const })),
}));

/**
 * THE DAILY CHECK-IN ON OPEN POSITIONS.
 *
 * The number this card shows is `daysInTrade` — which day the position is being
 * held on, and how long its time stop is. It is the only counter in the
 * application that is 1-BASED (the day of opening counts as the first), and
 * Step 5 removed the second IMPLEMENTATION around that convention while keeping
 * the distinction. The claim here is that the distinction reaches the screen in
 * a shape a human reads.
 *
 * The second part is the state with no answer. `null` in this card means "I did
 * not show up today", not "the thesis is intact" — the same distinction the
 * whole project is careful not to blur, here in the most visible place.
 */

const pos = (over: Partial<OpenPositionView> = {}): OpenPositionView => ({
  id: "p1",
  label: "ES Long",
  daysInTrade: 3,
  timeStopDays: null,
  pastTimeStop: false,
  thesis: null,
  invalidation: null,
  checkin: null,
  ...over,
});

const draw = (positions: OpenPositionView[], locked = false) =>
  render(
    <OpenPositionsCard
      positions={positions}
      reportDate="2026-03-04"
      locked={locked}
    />,
  );

describe("counting days", () => {
  it("prints which day of the hold it is", () => {
    draw([pos({ daysInTrade: 3 })]);
    expect(screen.getByText(/dan 3/)).toBeInTheDocument();
  });

  it("with a time stop it says day N of M", () => {
    draw([pos({ daysInTrade: 3, timeStopDays: 5 })]);
    expect(screen.getByText(/dan 3 od 5/)).toBeInTheDocument();
  });

  it("with no time stop it does not invent an upper bound", () => {
    draw([pos({ daysInTrade: 3, timeStopDays: null })]);
    expect(screen.getByText(/dan 3/).textContent).toBe("dan 3");
  });

  it("the first day is 1, not 0 — the counter is 1-based", () => {
    // `daysBetweenKeys` counts the day of opening as the first session. A zero
    // would mean the position had not been opened at all yet.
    draw([pos({ daysInTrade: 1 })]);
    expect(screen.getByText(/dan 1/)).toBeInTheDocument();
  });
});

describe("a time stop that has run out", () => {
  it("carries a warning and a highlighted border", () => {
    const { container } = draw([
      pos({ daysInTrade: 7, timeStopDays: 5, pastTimeStop: true }),
    ]);
    expect(screen.getByText("Prošao time stop")).toBeInTheDocument();
    expect(container.querySelector(".border-amber-500\\/60")).toBeTruthy();
  });

  it("a position still inside its window has neither warning nor border", () => {
    draw([pos({ daysInTrade: 3, timeStopDays: 5, pastTimeStop: false })]);
    expect(screen.queryByText("Prošao time stop")).not.toBeInTheDocument();
  });
});

describe("answered versus silent", () => {
  it("a position with no answer has no tick", () => {
    draw([pos({ checkin: null })]);
    expect(screen.queryByLabelText("Prijavljeno")).not.toBeInTheDocument();
  });

  it("an answered position carries a tick", () => {
    draw([
      pos({
        checkin: {
          position_id: "p1",
          report_date: "2026-03-04",
          thesis_state: "intact",
          touched: null,
          note: null,
        } as OpenPositionView["checkin"],
      }),
    ]);
    expect(screen.getByLabelText("Prijavljeno")).toBeInTheDocument();
  });

  it("a bare `touched` with no thesis is NOT an answer", () => {
    // The tick follows the thesis, not the touch. "I moved the stop" without a
    // verdict on the thesis is half an answer, and the card must not show that
    // as a finished day.
    draw([
      pos({
        checkin: {
          position_id: "p1",
          report_date: "2026-03-04",
          thesis_state: null,
          touched: "stop_moved",
          note: null,
        } as OpenPositionView["checkin"],
      }),
    ]);
    expect(screen.queryByLabelText("Prijavljeno")).not.toBeInTheDocument();
  });
});

describe("several positions", () => {
  it("each carries its own day count", () => {
    const { container } = draw([
      pos({ id: "a", label: "ES Long", daysInTrade: 2 }),
      pos({ id: "b", label: "EURUSD Short", daysInTrade: 9, timeStopDays: 10 }),
    ]);
    const es = container.querySelector<HTMLElement>('a[href="/trades/a/edit"]')
      ?.parentElement as HTMLElement;
    const fx = container.querySelector<HTMLElement>('a[href="/trades/b/edit"]')
      ?.parentElement as HTMLElement;
    expect(within(es).getByText(/dan 2/)).toBeInTheDocument();
    expect(within(fx).getByText(/dan 9 od 10/)).toBeInTheDocument();
  });

  it("each links to its own trade — the edit page, the only trade page there is", () => {
    const { container } = draw([
      pos({ id: "a", label: "ES Long" }),
      pos({ id: "b", label: "EURUSD Short" }),
    ]);
    expect(container.querySelector('a[href="/trades/a/edit"]')).toBeTruthy();
    expect(container.querySelector('a[href="/trades/b/edit"]')).toBeTruthy();
  });
});

describe("a locked day", () => {
  it("the buttons are disabled when the day is locked", () => {
    const { container } = draw([pos()], true);
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((b) => b.hasAttribute("disabled"))).toBe(true);
  });

  it("an unlocked day has usable buttons", () => {
    const { container } = draw([pos()], false);
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons.some((b) => !b.hasAttribute("disabled"))).toBe(true);
  });
});
