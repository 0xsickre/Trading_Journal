import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RuleGroupDialog } from "./rule-group-dialog";
import type {
  LinkedRule,
  Playbook,
  PlaybookSection,
} from "@/lib/journal/playbook-types";


const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const actions = vi.hoisted(() => ({
  addPlaybookRule: vi.fn(async () => ({ ok: true as const })),
  // Deliberately NOT an id the test could guess: the dialog must file rules
  // under the id the server assigned, never under one it derived from the label.
  addPlaybookSection: vi.fn(async () => ({ ok: true as const, id: "sec-new" })),
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
  sections: [],
  rules: [],
};

const SECTION: PlaybookSection = {
  id: "sec-entry",
  label: "Entry criteria",
  description: "What has to be true at the moment you take it.",
  sort_order: 0,
};

function rule(over: Partial<LinkedRule> & { id: string }): LinkedRule {
  return {
    text: over.id,
    show_when: "always",
    sort_order: 0,
    deleted_at: null,
    answerCount: 0,
    link_id: `link-${over.id}`,
    section_id: SECTION.id,
    is_setup_criterion: false,
    link_sort: 0,
    ...over,
  };
}

function renderEdit(
  rules: LinkedRule[],
  over: { section?: Partial<PlaybookSection> } = {},
) {
  const onOpenChange = vi.fn();
  render(
    <RuleGroupDialog
      book={BOOK}
      section={{ ...SECTION, ...over.section }}
      rules={rules}
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
    // A Save that reissued every field would bump `updated_at` on rows nobody
    // edited, and would resend `show_when` on locked rules — which the action
    // refuses. Untouched has to mean untouched.
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
      text: "Enter inside OTE",
      show_when: "always",
      playbook_id: "pb",
      section_id: "sec-entry",
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

    expect(actions.updatePlaybookSection).toHaveBeenCalledWith("sec-entry", {
      label: "Trigger",
      description: "Only what I can see on the daily.",
    });
  });

  it("clears the line back to null when the field is emptied", async () => {
    // An absence is what "I deleted the sentence" means, so it has to reach the
    // database as null rather than as "".
    const user = userEvent.setup();
    renderEdit([], { section: { description: "My own words." } });

    await user.clear(screen.getByLabelText("Group description"));
    await save(user);

    expect(actions.updatePlaybookSection).toHaveBeenCalledWith("sec-entry", {
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

  it("creates the section IN THIS BOOK, then writes its rules under the id it returned", async () => {
    // Two things at once. The section is scoped to `book.id`, so the same
    // heading in another playbook is a different row and is not touched — and
    // the rules go under the id that came BACK, not one the dialog guessed.
    const user = userEvent.setup();
    renderAdd();

    await user.type(screen.getByLabelText("Group name"), "Entry criteria");
    await user.type(screen.getByLabelText("Rule 1"), "Price at HTF POI");
    await save(user);

    expect(actions.addPlaybookSection).toHaveBeenCalledWith("pb", "Entry criteria");
    expect(actions.addPlaybookRule).toHaveBeenCalledWith({
      text: "Price at HTF POI",
      show_when: "always",
      playbook_id: "pb",
      section_id: "sec-new",
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
