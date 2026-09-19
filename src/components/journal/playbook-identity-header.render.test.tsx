import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlaybookIdentityHeader } from "./playbook-identity-header";
import type { Playbook } from "@/lib/journal/playbook-types";

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn() } }));

const updateMock = vi.fn();
const deleteMock = vi.fn();
vi.mock("@/app/(app)/settings/playbook-actions", () => ({
  updatePlaybook: (...a: unknown[]) => updateMock(...a),
  deletePlaybook: (...a: unknown[]) => deleteMock(...a),
}));

const BOOK: Playbook = {
  id: "pb-1",
  name: "London Reversal",
  description: null,
  color: null,
  icon: null,
  is_active: true,
  sort_order: 0,
  default_risk_pct: null,
  a_plus_criteria: null,
  sections: [],
  rules: [],
} as unknown as Playbook;

beforeEach(() => {
  pushMock.mockClear();
  refreshMock.mockClear();
  toastError.mockClear();
  updateMock.mockReset().mockResolvedValue({ ok: true });
  deleteMock.mockReset().mockResolvedValue({ ok: true });
});

describe("the playbook's details are editable", () => {
  it("saves description, default risk and A+ criteria from the details dialog", async () => {
    // None of the three had an editor: the trade form's risk prefill and A+
    // line could never be set.
    const user = userEvent.setup({ delay: null });
    render(<PlaybookIdentityHeader book={BOOK} />);
    await user.click(screen.getByRole("button", { name: /Edit details/ }));
    await user.type(screen.getByLabelText("Description"), "Sweep of London high");
    await user.type(screen.getByLabelText("Default risk %"), "0,5");
    await user.type(screen.getByLabelText("A+ criteria"), "HTF bias + sweep + FVG");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await vi.waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith("pb-1", {
        description: "Sweep of London high",
        default_risk_pct: 0.5,
        a_plus_criteria: "HTF bias + sweep + FVG",
      }),
    );
  });

  it("refuses a default risk outside 0–100 before any round trip", async () => {
    const user = userEvent.setup({ delay: null });
    render(<PlaybookIdentityHeader book={BOOK} />);
    await user.click(screen.getByRole("button", { name: /Edit details/ }));
    await user.type(screen.getByLabelText("Default risk %"), "150");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("shows the default risk and the A+ line once they are set", () => {
    render(
      <PlaybookIdentityHeader book={{ ...BOOK, default_risk_pct: 1, a_plus_criteria: "Clean sweep" }} />,
    );
    expect(screen.getByText("Risk 1%")).toBeInTheDocument();
    expect(screen.getByText("Clean sweep")).toBeInTheDocument();
  });
});

describe("renaming", () => {
  it("puts the old name back when the box is emptied, instead of leaving it blank", async () => {
    const user = userEvent.setup({ delay: null });
    render(<PlaybookIdentityHeader book={BOOK} />);
    const input = screen.getByLabelText("Playbook name");
    await user.clear(input);
    await user.tab();
    expect(input).toHaveValue("London Reversal");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("saves on Enter", async () => {
    const user = userEvent.setup({ delay: null });
    render(<PlaybookIdentityHeader book={BOOK} />);
    const input = screen.getByLabelText("Playbook name");
    await user.clear(input);
    await user.type(input, "NY Reversal{Enter}");
    await vi.waitFor(() => expect(updateMock).toHaveBeenCalledWith("pb-1", { name: "NY Reversal" }));
  });
});

describe("deleting", () => {
  it("asks first, and only then deletes", async () => {
    const user = userEvent.setup({ delay: null });
    render(<PlaybookIdentityHeader book={BOOK} />);
    await user.click(screen.getByRole("button", { name: "Delete playbook" }));
    expect(deleteMock).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: /Delete “London Reversal”/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await vi.waitFor(() => expect(deleteMock).toHaveBeenCalledWith("pb-1"));
    expect(pushMock).toHaveBeenCalledWith("/playbooks");
  });
});
