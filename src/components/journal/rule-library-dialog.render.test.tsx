import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RuleLibraryDialog } from "./rule-library-dialog";
import type { PlaybookRule } from "@/lib/journal/playbook-types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
const deleteMock = vi.fn();
const linkMock = vi.fn();
vi.mock("@/app/(app)/settings/playbook-actions", () => ({
  deletePlaybookRule: (...a: unknown[]) => deleteMock(...a),
  linkRule: (...a: unknown[]) => linkMock(...a),
}));

const rule = (id: string, text: string, answerCount: number): PlaybookRule =>
  ({ id, text, show_when: "always", sort_order: 0, deleted_at: null, answerCount }) as unknown as PlaybookRule;

const draw = () =>
  render(
    <RuleLibraryDialog
      playbookId="pb-1"
      section={{ id: "s1", label: "Entry", description: null, sort_order: 0 }}
      available={[
        rule("unused", "Wait for the sweep", 0),
        rule("used", "HTF bias agrees", 7),
        rule("linked", "Killzone only", 0),
      ]}
      open
      onOpenChange={() => {}}
      linkedRuleIds={["linked"]}
    />,
  );

beforeEach(() => {
  deleteMock.mockReset().mockResolvedValue({ ok: true });
  linkMock.mockReset().mockResolvedValue({ ok: true });
});

describe("RuleLibraryDialog — deleting unused rules", () => {
  it("offers a bin only on rules no trade has answered AND no playbook uses", () => {
    draw();
    expect(screen.getByRole("button", { name: "Delete rule: Wait for the sweep" })).toBeInTheDocument();
    // Answered on seven trades — its statistics are history.
    expect(screen.queryByRole("button", { name: /Delete rule: HTF bias agrees/ })).not.toBeInTheDocument();
    // Never answered, but another playbook still checks it.
    expect(screen.queryByRole("button", { name: /Delete rule: Killzone only/ })).not.toBeInTheDocument();
  });

  it("asks once more, then deletes and drops the row", async () => {
    const user = userEvent.setup({ delay: null });
    draw();
    await user.click(screen.getByRole("button", { name: "Delete rule: Wait for the sweep" }));
    expect(deleteMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Confirm delete: Wait for the sweep" }));
    await vi.waitFor(() => expect(deleteMock).toHaveBeenCalledWith("unused"));
    await vi.waitFor(() => expect(screen.queryByText("Wait for the sweep")).not.toBeInTheDocument());
    // Picking a rule still links it, as before.
    expect(linkMock).not.toHaveBeenCalled();
  });
});
