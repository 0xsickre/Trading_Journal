import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MissedSetupForm } from "./missed-setup-form";
import type { Account } from "@/lib/journal/types";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock, refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
const createMock = vi.fn().mockResolvedValue({ ok: true, id: "m1" });
vi.mock("@/app/(app)/trades/actions", () => ({ createMissedSetup: (...a: unknown[]) => createMock(...a) }));

const ACCOUNT = {
  id: "00000000-0000-4000-8000-0000000000a1",
  name: "50K Combine",
  timezone: "Europe/Belgrade",
  is_active: true,
  archived_at: null,
} as unknown as Account;

describe("MissedSetupForm (phase O)", () => {
  it("saves a setup off the recording, its time read on the account's clock", async () => {
    const user = userEvent.setup();
    render(
      <MissedSetupForm
        accounts={[ACCOUNT]}
        instruments={[{ symbol: "MNQ" }]}
        playbooks={[]}
        optionsMap={{}}
        today="2026-10-07"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Short" }));
    await user.type(screen.getByLabelText("Ulaz"), "31300");
    await user.type(screen.getByLabelText("Stop"), "31330");
    await user.type(screen.getByLabelText("Cilj"), "31200");
    await user.type(screen.getByLabelText(/Vreme/), "16:05");
    await user.click(screen.getByRole("button", { name: "Sačuvaj propušten setup" }));
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        instrument: "MNQ",
        direction: "Short",
        entry_price: 31300,
        stop_price: 31330,
        target_price: 31200,
        seen_at: "2026-10-07T14:05:00.000Z",
      }),
    );
    expect(pushMock).toHaveBeenCalledWith("/daily");
  });
});
