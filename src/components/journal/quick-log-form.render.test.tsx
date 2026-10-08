import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QuickLogForm, type ReviewTrade } from "./quick-log-form";
import type { Account, Instrument, OptionsMap } from "@/lib/journal/types";
import type { Playbook } from "@/lib/journal/playbook-types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));
const pushMock = vi.fn();

const toastErrorMock = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...a: unknown[]) => toastErrorMock(...a), success: vi.fn() },
}));

const createTradeMock = vi.fn();
const saveTradeReviewMock = vi.fn();
vi.mock("@/app/(app)/trades/actions", () => ({
  createTrade: (...a: unknown[]) => createTradeMock(...a),
  saveTradeReview: (...a: unknown[]) => saveTradeReviewMock(...a),
}));

const ACCOUNT = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Topstep-practice",
  currency: "USD",
  timezone: "Europe/Belgrade",
  archived_at: null,
  topstep_mode: true,
} as unknown as Account;

const MNQ = {
  id: "i1",
  symbol: "MNQ",
  point_value: 2,
  tick_size: 0.25,
  commission_per_lot: 0.61,
  commission_pct: 0,
} as unknown as Instrument;

const PLAYBOOK = { id: "00000000-0000-4000-8000-0000000000aa", name: "OR breakout", is_active: true } as unknown as Playbook;

const item = (value: string) => ({ id: value, value, label: value, color: null, description: null, sort_order: 0, is_active: true });
const OPTIONS = {
  mistake: ["Bez greške", "Pomerio stop", "Jurio cenu"].map(item),
  emotion: ["FOMO", "Revenge"].map(item),
  exit_reason: ["Pogođen target", "Pogođen stop", "Na nuli", "Zatvoreno ranije"].map(item),
} as unknown as OptionsMap;

function renderLog() {
  return render(<QuickLogForm accounts={[ACCOUNT]} instruments={[MNQ]} playbooks={[PLAYBOOK]} optionsMap={OPTIONS} />);
}

beforeEach(() => {
  createTradeMock.mockReset().mockResolvedValue({ ok: true, id: "new" });
  saveTradeReviewMock.mockReset().mockResolvedValue({ ok: true, id: "t1" });
  toastErrorMock.mockReset();
  pushMock.mockReset();
  localStorage.clear();
});

describe("QuickLogForm on a blown prop-firm account", () => {
  it("warns above the form but still logs the trade — the record, not new exposure", async () => {
    const user = userEvent.setup();
    render(
      <QuickLogForm
        accounts={[ACCOUNT]}
        instruments={[MNQ]}
        playbooks={[PLAYBOOK]}
        optionsMap={OPTIONS}
        topstepFailedAccountIds={[ACCOUNT.id]}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/hit its Maximum Loss Limit/);
    await user.type(screen.getByLabelText("Entry"), "30584");
    await user.type(screen.getByLabelText("Exit (empty = still open)"), "30604");
    await user.click(screen.getByRole("button", { name: "5 min ago" }));
    await user.click(screen.getByRole("button", { name: /^A(?!dd chart)/ }));
    await user.click(screen.getByRole("button", { name: "Log trade" }));
    expect(createTradeMock).toHaveBeenCalledOnce();
    expect(createTradeMock.mock.calls[0][0].origin).toBe("log");
  });

  it("shows no warning on a healthy account", () => {
    renderLog();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("QuickLogForm — a trade still running", () => {
  it("saves it open with the entry fill only, and says the import will close it", async () => {
    const user = userEvent.setup();
    renderLog();
    await user.type(screen.getByLabelText("Entry"), "30584");
    await user.type(screen.getByLabelText("Stop"), "30564");
    expect(screen.queryByLabelText("Exited at")).not.toBeInTheDocument();
    expect(screen.getByText(/the trade is saved open/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^A(?!dd chart)/ }));
    await user.click(screen.getByRole("button", { name: "Log trade" }));
    const sent = createTradeMock.mock.calls[0][0];
    expect(sent.executions.map((e: { side: string }) => e.side)).toEqual(["entry"]);
    expect(sent.fields).not.toHaveProperty("exit_reason");
  });
});

describe("QuickLogForm — logging after the trade", () => {
  it("asks for four numbers and three answers, nothing from the plan form", () => {
    renderLog();
    for (const label of ["Contracts", "Entry", "Stop", "Target (optional)", "Exit (empty = still open)"]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("OR breakout")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^A(?!dd chart)/ })).toBeInTheDocument();
    expect(screen.queryByText(/thesis/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/MAE|MFE/)).not.toBeInTheDocument();
    // Mistakes only once the trade was not by plan.
    expect(screen.queryByText("Pomerio stop")).not.toBeInTheDocument();
  });

  it("the save waits for the numbers", () => {
    renderLog();
    expect(screen.getByRole("button", { name: "Log trade" })).toBeDisabled();
    expect(screen.getByText("Entry price is missing.")).toBeInTheDocument();
  });

  it("logs a B trade with its mistake, and an A trade as 'No mistake'", async () => {
    const user = userEvent.setup();
    renderLog();
    await user.click(screen.getByRole("button", { name: "Short" }));
    await user.clear(screen.getByLabelText("Contracts"));
    await user.type(screen.getByLabelText("Contracts"), "2");
    await user.type(screen.getByLabelText("Entry"), "30584");
    await user.type(screen.getByLabelText("Stop"), "30604");
    await user.type(screen.getByLabelText("Exit (empty = still open)"), "30604");
    await user.click(screen.getByRole("button", { name: "5 min ago" }));
    await user.click(screen.getByText("OR breakout"));
    await user.click(screen.getByRole("button", { name: /^B/ }));
    await user.click(screen.getByText("Pomerio stop"));
    await user.click(screen.getByText("FOMO"));
    await user.click(screen.getByRole("button", { name: "Log trade" }));

    const input = createTradeMock.mock.calls[0][0];
    expect(input.fields).toMatchObject({
      instrument: "MNQ",
      direction: "Short",
      entry_price: 30584,
      stop_price: 30604,
      execution_rating: 3,
      mistake: ["Pomerio stop"],
      psychology_tags: ["FOMO"],
      exit_reason: "Pogođen stop",
    });
    expect(input.playbook_id).toBe(PLAYBOOK.id);
    expect(input.executions.map((e: { side: string; qty: number; fee: number }) => [e.side, e.qty, e.fee])).toEqual([
      ["entry", 2, 1.22],
      ["exit", 2, 1.22],
    ]);
    expect(Date.parse(input.executions[0].executed_at)).toBeLessThanOrEqual(Date.parse(input.executions[1].executed_at));

    // The form is cleared for the next trade; the instrument is remembered.
    expect(screen.getByLabelText("Entry")).toHaveValue("");
    expect(JSON.parse(localStorage.getItem("tj:trade_form_prefs") ?? "{}").instrument).toBe("MNQ");

    // Direction is kept like the instrument; this one is a long.
    await user.click(screen.getByRole("button", { name: "Long" }));
    await user.type(screen.getByLabelText("Entry"), "30584");
    await user.type(screen.getByLabelText("Stop"), "30564");
    await user.type(screen.getByLabelText("Exit (empty = still open)"), "30620");
    await user.click(screen.getByRole("button", { name: /^A(?!dd chart)/ }));
    await user.click(screen.getByRole("button", { name: "Log trade" }));
    expect(createTradeMock.mock.calls[1][0].fields).toMatchObject({ execution_rating: 5, mistake: ["Bez greške"] });
  });
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
    render(<QuickLogForm accounts={[ACCOUNT]} instruments={[]} playbooks={[PLAYBOOK]} optionsMap={OPTIONS} review={trade} />);
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
    render(<QuickLogForm accounts={[ACCOUNT]} instruments={[]} playbooks={[PLAYBOOK]} optionsMap={OPTIONS} review={moved} />);
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
