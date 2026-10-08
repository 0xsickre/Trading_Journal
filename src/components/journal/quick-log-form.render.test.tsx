import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QuickLogForm, type ReviewTrade } from "./quick-log-form";
import type { OptionsMap } from "@/lib/journal/types";
import type { Playbook } from "@/lib/journal/playbook-types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));
const pushMock = vi.fn();

const toastErrorMock = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...a: unknown[]) => toastErrorMock(...a), success: vi.fn() },
}));

const saveTradeReviewMock = vi.fn();
vi.mock("@/app/(app)/trades/actions", () => ({
  saveTradeReview: (...a: unknown[]) => saveTradeReviewMock(...a),
}));

const PLAYBOOK = { id: "00000000-0000-4000-8000-0000000000aa", name: "OR breakout", is_active: true } as unknown as Playbook;

const item = (value: string) => ({ id: value, value, label: value, color: null, description: null, sort_order: 0, is_active: true });
const OPTIONS = {
  mistake: ["Bez greške", "Pomerio stop", "Jurio cenu"].map(item),
  emotion: ["FOMO", "Revenge"].map(item),
  exit_reason: ["Pogođen target", "Pogođen stop", "Na nuli", "Zatvoreno ranije"].map(item),
} as unknown as OptionsMap;

beforeEach(() => {
  saveTradeReviewMock.mockReset().mockResolvedValue({ ok: true, id: "t1" });
  toastErrorMock.mockReset();
  pushMock.mockReset();
  localStorage.clear();
});

describe("QuickLogForm — reviewing an imported trade", () => {
  const trade: ReviewTrade = {
    id: "00000000-0000-4000-8000-0000000000t1",
    label: "#3 MNQ",
    currency: "USD",
    direction: "Short",
    qty: 1,
    avgEntry: 30584,
    avgExit: 30600.25,
    stop: 30604,
    target: null,
    tickSize: 0.25,
    netPl: -33.72,
    realizedR: -0.81,
    playbookId: null,
    rating: null,
    mistake: [],
    psychology: [],
    notes: null,
    images: [],
  };

  it("shows the fills as fixed and saves only the review", async () => {
    const user = userEvent.setup();
    render(<QuickLogForm playbooks={[PLAYBOOK]} optionsMap={OPTIONS} review={trade} />);
    expect(screen.getByText("#3 MNQ")).toBeInTheDocument();
    expect(screen.queryByLabelText("Entry")).not.toBeInTheDocument();
    await user.click(screen.getByText("OR breakout"));
    await user.click(screen.getByRole("button", { name: /^C/ }));
    await user.click(screen.getByText("Jurio cenu"));
    await user.click(screen.getByRole("button", { name: "Save review" }));
    expect(saveTradeReviewMock).toHaveBeenCalledWith(trade.id, {
      playbook_id: PLAYBOOK.id,
      execution_rating: 1,
      mistake: ["Jurio cenu"],
      psychology_tags: [],
      trade_journal_notes: "",
      stop_price: 30604,
      target_price: null,
      thesis: null,
      exit_reason: "Zatvoreno ranije",
      images: [],
    });
    expect(pushMock).toHaveBeenCalledWith("/daily");
  });

  it("asks for the original stop when it was moved, and saves what the recording shows (phase O)", async () => {
    const user = userEvent.setup();
    const moved: ReviewTrade = {
      ...trade,
      stop: null,
      finalStop: 30584,
      stopNote: "Poslednji stop u platformi je na ulazu ili u profitu — pomeren je. Upiši originalni sa snimka.",
    };
    render(<QuickLogForm playbooks={[PLAYBOOK]} optionsMap={OPTIONS} review={moved} />);
    expect(screen.getByRole("alert")).toHaveTextContent("pomeren je");
    expect(screen.getByText("poslednji stop u platformi 30584")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Originalni stop (na ulazu)"), "30610");
    await user.type(screen.getByLabelText(/Šta sam rekao pre klika/), "Short sa ponoćnog pojasa, stop iznad 30610");
    await user.click(screen.getByRole("button", { name: "Save review" }));
    expect(saveTradeReviewMock.mock.calls[0][1]).toMatchObject({
      stop_price: 30610,
      thesis: "Short sa ponoćnog pojasa, stop iznad 30610",
    });
  });
});
