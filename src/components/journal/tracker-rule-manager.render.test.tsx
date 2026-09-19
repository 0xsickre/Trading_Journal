import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TrackerRuleManager } from "./tracker-rule-manager";
import type { TrackerRule } from "@/lib/journal/tracker-types";

/**
 * The daily rules as they are edited.
 *
 * Everything here guards the same thing: a screen that changes CONFIGURATION
 * must not rewrite HISTORY. Retiring is a question, not a click; a rule always
 * keeps a day to be scored on; and the stages are named in the language the
 * rest of the app speaks.
 */

const addTrackerRule = vi.fn();
const updateTrackerRule = vi.fn();
const deleteTrackerRule = vi.fn();
const restoreTrackerRule = vi.fn();
const moveTrackerRule = vi.fn();

vi.mock("@/app/(app)/settings/tracker-actions", () => ({
  addTrackerRule: (...a: unknown[]) => addTrackerRule(...a),
  updateTrackerRule: (...a: unknown[]) => updateTrackerRule(...a),
  deleteTrackerRule: (...a: unknown[]) => deleteTrackerRule(...a),
  restoreTrackerRule: (...a: unknown[]) => restoreTrackerRule(...a),
  moveTrackerRule: (...a: unknown[]) => moveTrackerRule(...a),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function rule(over: Partial<TrackerRule> = {}): TrackerRule {
  return {
    id: "r1",
    text: "Mark the weekly range",
    stage: "prepare",
    active_days: [1, 2, 3, 4, 5],
    auto_key: null,
    config: {},
    is_mandatory: false,
    sort_order: 0,
    created_at: "2026-09-01T06:00:00Z",
    deleted_at: null,
    ...over,
  };
}

/** The row a rule's text sits in — where its buttons and toggles live. */
function rowOf(text: string): HTMLElement {
  return screen.getByDisplayValue(text).closest("div") as HTMLElement;
}

beforeEach(() => {
  for (const m of [
    addTrackerRule,
    updateTrackerRule,
    deleteTrackerRule,
    restoreTrackerRule,
    moveTrackerRule,
  ]) {
    m.mockReset();
    m.mockResolvedValue({ ok: true });
  }
});

describe("the stages are in English", () => {
  it("names Prepare, Trade and Review", () => {
    render(<TrackerRuleManager rules={[rule()]} />);
    for (const name of ["Prepare", "Trade", "Review"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });
});

describe("retiring and restoring ask first", () => {
  it("retire opens a question and only then calls the action", async () => {
    const user = userEvent.setup();
    render(<TrackerRuleManager rules={[rule()]} />);

    await user.click(screen.getByRole("button", { name: "Retire rule" }));
    expect(deleteTrackerRule).not.toHaveBeenCalled();
    expect(await screen.findByText("Retire this rule?")).toBeInTheDocument();
    expect(screen.getByText(/Past days keep their score/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retire" }));
    expect(deleteTrackerRule).toHaveBeenCalledWith("r1");
  });

  it("cancelling leaves the rule alone", async () => {
    const user = userEvent.setup();
    render(<TrackerRuleManager rules={[rule()]} />);

    await user.click(screen.getByRole("button", { name: "Retire rule" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(deleteTrackerRule).not.toHaveBeenCalled();
  });

  it("a retired rule is restored through its own question", async () => {
    const user = userEvent.setup();
    render(
      <TrackerRuleManager
        rules={[rule({ deleted_at: "2026-09-10T06:00:00Z" })]}
      />,
    );

    expect(screen.getByText("Retired rules")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Restore rule" }));
    expect(await screen.findByText("Restore this rule?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Restore" }));
    expect(restoreTrackerRule).toHaveBeenCalledWith("r1");
  });
});

describe("a rule always has a day", () => {
  it("the last day on cannot be switched off", async () => {
    const user = userEvent.setup();
    render(<TrackerRuleManager rules={[rule({ active_days: [3] })]} />);

    const wed = within(rowOf("Mark the weekly range")).getByRole("button", { name: "Wed" });
    expect(wed).toBeDisabled();
    await user.click(wed);
    expect(updateTrackerRule).not.toHaveBeenCalled();
  });

  it("any other day still toggles", async () => {
    const user = userEvent.setup();
    render(<TrackerRuleManager rules={[rule({ active_days: [1, 3] })]} />);

    await user.click(
      within(rowOf("Mark the weekly range")).getByRole("button", { name: "Mon" }),
    );
    expect(updateTrackerRule).toHaveBeenCalledWith("r1", { active_days: [3] });
  });
});

describe("reordering stops at the ends", () => {
  const two = [rule(), rule({ id: "r2", text: "Check the news", sort_order: 1 })];

  it("the first cannot move up and the last cannot move down", () => {
    render(<TrackerRuleManager rules={two} />);

    const first = rowOf("Mark the weekly range");
    const last = rowOf("Check the news");
    expect(within(first).getByRole("button", { name: "Move up" })).toBeDisabled();
    expect(within(first).getByRole("button", { name: "Move down" })).toBeEnabled();
    expect(within(last).getByRole("button", { name: "Move down" })).toBeDisabled();
  });
});

describe("the text box", () => {
  it("an emptied rule keeps its text rather than saving a blank", async () => {
    const user = userEvent.setup();
    render(<TrackerRuleManager rules={[rule()]} />);

    const box = screen.getByDisplayValue("Mark the weekly range");
    await user.clear(box);
    await user.tab();

    expect(updateTrackerRule).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("Mark the weekly range")).toBeInTheDocument();
  });

  it("an edit is saved on blur", async () => {
    const user = userEvent.setup();
    render(<TrackerRuleManager rules={[rule()]} />);

    const box = screen.getByDisplayValue("Mark the weekly range");
    await user.clear(box);
    await user.type(box, "Mark the daily range");
    await user.tab();

    expect(updateTrackerRule).toHaveBeenCalledWith("r1", { text: "Mark the daily range" });
  });
});

describe("adding a rule", () => {
  it("Add is off while the box is empty, and on once it is not", async () => {
    const user = userEvent.setup();
    render(<TrackerRuleManager rules={[]} />);

    const form = screen.getByLabelText("New prepare rule").closest("div") as HTMLElement;
    expect(within(form).getByRole("button", { name: "Add" })).toBeDisabled();

    await user.type(screen.getByLabelText("New prepare rule"), "Read the plan");
    await user.click(within(form).getByRole("button", { name: "Add" }));

    expect(addTrackerRule).toHaveBeenCalledWith({
      text: "Read the plan",
      stage: "prepare",
      active_days: [1, 2, 3, 4, 5],
    });
  });
});
