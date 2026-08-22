import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RuleGroupDialog } from "./rule-group-dialog";
import type { Playbook, PlaybookRule } from "@/lib/journal/playbook-types";
import type { OptionItem } from "@/lib/journal/types";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const actions = vi.hoisted(() => ({
  addPlaybookRule: vi.fn(async () => ({ ok: true as const })),
  addPlaybookSection: vi.fn(async () => ({
    ok: true as const,
    // Deliberately NOT the label typed in the test: the dialog must write rules
    // under the value the server assigned, never under what was typed.
    value: "entry_criteria_value",
    id: "sec-new",
  })),
  unlinkRule: vi.fn(async () => ({ ok: true as const })),
  updatePlaybookRule: vi.fn(async () => ({ ok: true as const })),
  updatePlaybookSection: vi.fn(async () => ({ ok: true as const })),
}));
vi.mock("@/app/(app)/settings/playbook-actions", () => actions);

beforeEach(() => vi.clearAllMocks());

const BOOK: Playbook = {
  id: "pb",
  name: "London Reversal",
  description: null,
  color: null,
  icon: null,
  is_active: true,
  sort_order: 0,
  default_risk_pct: 1,
  a_plus_criteria: null,
  rules: [],
};

const ITEM: OptionItem = {
  id: "oc1",
  value: "entry",
  label: "Entry criteria",
  color: null,
  description: null,
  is_active: true,
  sort_order: 0,
};

function rule(over: Partial<PlaybookRule> & { id: string }): PlaybookRule {
  return {
    category: "entry",
    text: over.id,
    show_when: "always",
    is_setup_criterion: false,
    sort_order: 0,
    deleted_at: null,
    answerCount: 0,
    ...over,
  };
}

function renderEdit(
  rules: PlaybookRule[],
  over: { item?: Partial<OptionItem>; hint?: string } = {},
) {
  const onOpenChange = vi.fn();
  render(
    <RuleGroupDialog
      book={BOOK}
      section={{
        item: { ...ITEM, ...over.item },
        category: "entry",
        rules,
        // What the CARD is currently showing — the built-in hint for a seeded
        // section, or the section's own description once it has one.
        hint: over.hint ?? "What has to be true at the moment you take it.",
      }}
      open
      onOpenChange={onOpenChange}
    />,
  );
  return { onOpenChange };
}

const save = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: "Save" }));

describe("RuleGroupDialog — editing an existing group", () => {
  it("opens with the group's name, its line, and every rule already in it", () => {
    // The reason adding a rule goes through this dialog at all: the rule most
    // likely to be written badly is the one that repeats a rule already here,
    // and this is the only view that shows them while you type the new one.
    renderEdit([
      rule({ id: "r1", text: "Price at HTF POI" }),
      rule({ id: "r2", text: "Liquidity sweep at POI" }),
    ]);

    expect(screen.getByLabelText("Group name")).toHaveValue("Entry criteria");
    expect(screen.getByLabelText("Group description")).toHaveValue(
      "What has to be true at the moment you take it.",
    );
    expect(screen.getByLabelText("Rule 1")).toHaveValue("Price at HTF POI");
    expect(screen.getByLabelText("Rule 2")).toHaveValue("Liquidity sweep at POI");
  });

  it("writes nothing at all when Save is pressed with nothing touched", async () => {
    // The trap worth a test: the description field is SEEDED with the built-in
    // hint while the column is still null. Comparing the field to the column
    // instead of to what it was seeded with would write that constant into the
    // database the first time anyone opened this dialog and saved.
    const user = userEvent.setup();
    const { onOpenChange } = renderEdit([rule({ id: "r1", text: "Price at HTF POI" })]);

    await save(user);

    expect(actions.updatePlaybookSection).not.toHaveBeenCalled();
    expect(actions.updatePlaybookRule).not.toHaveBeenCalled();
    expect(actions.addPlaybookRule).not.toHaveBeenCalled();
    expect(actions.unlinkRule).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("adds a typed rule under this group and this playbook", async () => {
    const user = userEvent.setup();
    renderEdit([rule({ id: "r1", text: "Price at HTF POI" })]);

    await user.click(screen.getByRole("button", { name: /Add rule/ }));
    await user.type(screen.getByLabelText("Rule 2"), "Enter inside OTE");
    await save(user);

    expect(actions.addPlaybookRule).toHaveBeenCalledWith({
      category: "entry",
      text: "Enter inside OTE",
      show_when: "always",
      playbook_id: "pb",
    });
  });

  it("sends only the field that changed when a rule is reworded", async () => {
    const user = userEvent.setup();
    renderEdit([rule({ id: "r1", text: "Price at HTF POI" })]);

    const input = screen.getByLabelText("Rule 1");
    await user.clear(input);
    await user.type(input, "Price at HTF POI (OB/FVG)");
    await save(user);

    // No `show_when` in the patch — resending it would trip the action's own
    // refusal on rules that are merely being renamed.
    expect(actions.updatePlaybookRule).toHaveBeenCalledWith("r1", {
      text: "Price at HTF POI (OB/FVG)",
    });
  });

  it("removes a rule from the playbook without deleting it", async () => {
    // ✕ here means "this checklist no longer asks it". The rule keeps its id,
    // its wording and every answer ever recorded against it, and any other
    // playbook using it is untouched — retiring it everywhere is a different
    // act, on a different menu.
    const user = userEvent.setup();
    renderEdit([
      rule({ id: "r1", text: "Price at HTF POI" }),
      rule({ id: "r2", text: "Liquidity sweep at POI" }),
    ]);

    await user.click(screen.getByRole("button", { name: "Remove rule 2" }));
    await save(user);

    expect(actions.unlinkRule).toHaveBeenCalledWith("pb", "r2");
  });

  it("does not unlink until Save — Cancel really discards", async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderEdit([rule({ id: "r1", text: "Price at HTF POI" })]);

    await user.click(screen.getByRole("button", { name: "Remove rule 1" }));
    expect(actions.unlinkRule).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(actions.unlinkRule).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("saves a renamed heading and a rewritten line together", async () => {
    const user = userEvent.setup();
    renderEdit([]);

    const name = screen.getByLabelText("Group name");
    await user.clear(name);
    await user.type(name, "Trigger");
    const hint = screen.getByLabelText("Group description");
    await user.clear(hint);
    await user.type(hint, "Only what I can see on the daily.");
    await save(user);

    expect(actions.updatePlaybookSection).toHaveBeenCalledWith("oc1", {
      label: "Trigger",
      description: "Only what I can see on the daily.",
    });
  });

  it("clears the line back to null when the field is emptied", async () => {
    // Null is what makes the built-in hint reappear for a seeded section, so
    // "delete the sentence" has to reach the database as null, not "".
    const user = userEvent.setup();
    renderEdit([], { hint: "My own words." });

    await user.clear(screen.getByLabelText("Group description"));
    await save(user);

    expect(actions.updatePlaybookSection).toHaveBeenCalledWith("oc1", {
      description: null,
    });
  });

  it("locks `when it shows` on a rule that trades have already answered", () => {
    renderEdit([rule({ id: "r1", text: "Price at HTF POI", answerCount: 6 })]);

    const select = screen.getByLabelText("When rule 1 shows");
    expect(select).toBeDisabled();
    expect(select).toHaveAttribute(
      "title",
      expect.stringContaining("already answered"),
    );
  });

  it("ignores a row left blank instead of writing an empty rule", async () => {
    const user = userEvent.setup();
    renderEdit([rule({ id: "r1", text: "Price at HTF POI" })]);

    await user.click(screen.getByRole("button", { name: /Add rule/ }));
    await save(user);

    expect(actions.addPlaybookRule).not.toHaveBeenCalled();
  });
});

describe("RuleGroupDialog — creating a group", () => {
  function renderAdd() {
    const onOpenChange = vi.fn();
    render(<RuleGroupDialog book={BOOK} open onOpenChange={onOpenChange} />);
    return { onOpenChange };
  }

  it("opens empty, with one blank rule ready to type into", () => {
    renderAdd();
    expect(screen.getByLabelText("Group name")).toHaveValue("");
    expect(screen.getByLabelText("Rule 1")).toHaveValue("");
  });

  it("creates the group, then writes its rules under the value the server gave", async () => {
    // Not the typed label. `tj_add_option_item` writes the trimmed label into
    // `value` today, but the dialog has no business encoding that — it uses
    // what came back.
    const user = userEvent.setup();
    renderAdd();

    await user.type(screen.getByLabelText("Group name"), "Entry criteria");
    await user.type(screen.getByLabelText("Rule 1"), "Price at HTF POI");
    await save(user);

    expect(actions.addPlaybookSection).toHaveBeenCalledWith("Entry criteria");
    expect(actions.addPlaybookRule).toHaveBeenCalledWith({
      category: "entry_criteria_value",
      text: "Price at HTF POI",
      show_when: "always",
      playbook_id: "pb",
    });
  });

  it("refuses to save a group with no name", async () => {
    const user = userEvent.setup();
    renderAdd();

    await user.type(screen.getByLabelText("Rule 1"), "Price at HTF POI");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(actions.addPlaybookSection).not.toHaveBeenCalled();
  });

  it("stops at the first failure rather than reporting a success it cannot vouch for", async () => {
    // There is no transaction across server actions. If the group was created
    // and a rule then failed, the dialog must say so and leave itself open over
    // refreshed data — not close as though everything landed.
    const user = userEvent.setup();
    actions.addPlaybookRule.mockResolvedValueOnce({
      ok: false,
      error: "Insert failed",
    } as never);
    const { onOpenChange } = renderAdd();

    await user.type(screen.getByLabelText("Group name"), "Entry criteria");
    await user.type(screen.getByLabelText("Rule 1"), "Price at HTF POI");
    await save(user);

    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
