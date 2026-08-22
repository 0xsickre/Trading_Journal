import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FocusGoalCard } from "./focus-goal-card";
import { daysOnActiveGoal, type FocusGoal } from "@/lib/journal/focus-goal";

// Same reason as `ftmo-banner.render.test.tsx`: no `AppRouterContext` in
// jsdom, and the save/end actions themselves are not under test here.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const goal = (over: Partial<FocusGoal> = {}): FocusGoal => ({
  id: "g1",
  user_id: "u1",
  goal_text: "Bez novih pozicija posle 2 gubitka",
  started_at: "2026-04-01T00:00:00Z",
  is_active: true,
  ended_at: null,
  created_at: "2026-04-01T00:00:00Z",
  updated_at: "2026-04-01T00:00:00Z",
  ...over,
});

describe("FocusGoalCard — real daysOnActiveGoal, no wall-clock read", () => {
  it("no goal yet prompts to set one, not a zeroed day count", () => {
    render(<FocusGoalCard goal={null} reportDate="2026-04-10" />);
    expect(screen.getByText(/Prvo postavi fokus cilj/)).toBeInTheDocument();
    expect(screen.queryByText(/Aktivan fokus/)).not.toBeInTheDocument();
  });

  it("day count comes from reportDate, matching the real lib function exactly", () => {
    const g = goal({ started_at: "2026-04-01T00:00:00Z" });
    const expected = daysOnActiveGoal(g, "2026-04-10");
    render(<FocusGoalCard goal={g} reportDate="2026-04-10" />);
    expect(screen.getByText(`Aktivan fokus · dan ${expected}`)).toBeInTheDocument();
    expect(screen.getByText(g.goal_text)).toBeInTheDocument();
  });

  it("day 1 on the goal's own start date, not day 0", () => {
    const g = goal({ started_at: "2026-04-10T00:00:00Z" });
    render(<FocusGoalCard goal={g} reportDate="2026-04-10" />);
    expect(screen.getByText("Aktivan fokus · dan 1")).toBeInTheDocument();
  });
});
