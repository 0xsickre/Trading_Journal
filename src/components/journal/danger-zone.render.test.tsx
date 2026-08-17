import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DangerZone } from "./danger-zone";
import { RESET_PHRASE } from "@/lib/journal/reset-phrase";

/**
 * The reset is the only operation in the application that deletes a whole book
 * and cannot be undone. Two things are therefore asserted on the SCREEN rather
 * than trusted to the action:
 *
 *  1. the button stays dead until the phrase is exactly right — a disabled
 *     attribute is the whole gate, and a refactor that drops it leaves a
 *     one-click wipe behind a dialog that still looks careful;
 *  2. the panel says that playbooks do NOT come back. Measured against the live
 *     project: `tj_seed_my_defaults` calls `tj_seed_defaults` and
 *     `tj_seed_instruments_defaults` only, so a reset ends with zero playbooks.
 *     A panel that lists what is restored and stays quiet about that is the
 *     failure this repo is built around — a true half-sentence read as the
 *     whole one.
 */

const resetAllDataMock = vi.fn();
vi.mock("@/app/(app)/settings/actions", () => ({
  resetAllData: (...a: unknown[]) => resetAllDataMock(...a),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  resetAllDataMock.mockReset();
  resetAllDataMock.mockResolvedValue({ ok: true });
});

async function openDialog() {
  const user = userEvent.setup();
  render(<DangerZone />);
  await user.click(screen.getByRole("button", { name: /Delete all data/ }));
  return user;
}

describe("DangerZone — the panel states what survives and what does not", () => {
  it("names the playbook gap, not only the restore", () => {
    render(<DangerZone />);
    expect(screen.getByText("Restored afterwards")).toBeInTheDocument();
    expect(screen.getByText("Not restored")).toBeInTheDocument();
    expect(
      screen.getByText(/Your playbooks and their rules\./),
    ).toBeInTheDocument();
  });
});

describe("DangerZone — the phrase is the gate", () => {
  it("the confirm button is disabled until the phrase is typed exactly", async () => {
    const user = await openDialog();
    const confirm = screen.getByRole("button", { name: /Delete everything$/ });
    expect(confirm).toBeDisabled();

    const box = screen.getByLabelText("Confirm reset phrase");

    // Close, but not the phrase. The near-miss matters more than the empty
    // case: it is what a half-remembered phrase actually looks like.
    await user.type(box, "RESET EVERYTHIN");
    expect(confirm).toBeDisabled();

    await user.type(box, "G");
    expect(confirm).toBeEnabled();
  });

  it("a lowercase phrase does not open the gate", async () => {
    const user = await openDialog();
    await user.type(
      screen.getByLabelText("Confirm reset phrase"),
      RESET_PHRASE.toLowerCase(),
    );
    expect(
      screen.getByRole("button", { name: /Delete everything$/ }),
    ).toBeDisabled();
  });

  it("nothing is called until the button is actually pressed", async () => {
    const user = await openDialog();
    await user.type(screen.getByLabelText("Confirm reset phrase"), RESET_PHRASE);
    expect(resetAllDataMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /Delete everything$/ }));
    expect(resetAllDataMock).toHaveBeenCalledWith(RESET_PHRASE);
  });
});
