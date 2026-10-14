import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TradePage, type TradePageTrade } from "./trade-page";
import type { OptionsMap } from "@/lib/journal/types";
import type { Playbook } from "@/lib/journal/playbook-types";
import type { FieldDef } from "@/lib/journal/field-def-types";
import { EXACT_ZERO_RANGE } from "@/lib/journal/breakeven";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

const toastErrorMock = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...a: unknown[]) => toastErrorMock(...a), success: vi.fn() },
}));

const saveMock = vi.fn();
const missedMock = vi.fn();
vi.mock("@/app/(app)/trades/actions", () => ({
  saveTradeReview: (...a: unknown[]) => saveMock(...a),
  updateMissedSetup: (...a: unknown[]) => missedMock(...a),
  deleteTrade: vi.fn(),
}));

const R1 = "00000000-0000-4000-8000-0000000000b1";
const R2 = "00000000-0000-4000-8000-0000000000b2";
const PLAYBOOK = {
  id: "00000000-0000-4000-8000-0000000000aa",
  name: "Ponoc pojas reversal",
  is_active: true,
  a_plus_criteria: null,
  sections: [{ id: "s1", label: "Zašto ulazim?", description: null, sort_order: 0 }],
  rules: [
    { id: R1, text: "Cena je u zoni pojasa", show_when: "always", deleted_at: null, section_id: "s1", is_setup_criterion: true },
    { id: R2, text: "BOS na 5m", show_when: "always", deleted_at: null, section_id: "s1", is_setup_criterion: true },
  ],
} as unknown as Playbook;

const def = (over: Partial<FieldDef> & { key: string }): FieldDef => ({
  id: over.key,
  label: over.key,
  field_type: "select",
  list_key: over.key,
  show_phase: "always",
  sort_order: 0,
  is_active: true,
  show_when: "always",
  ...over,
});
const CONTEXT = [def({ key: "htf_bias", label: "Bias dana (brief)" }), def({ key: "entry_tf", label: "Entry TF" })];
const REVIEW = [
  def({ key: "exit_reason", label: "Exit Reason", show_phase: "active" }),
  def({ key: "mistake", label: "Mistake", field_type: "tags", show_phase: "active" }),
];

const item = (value: string) => ({ id: value, value, label: value, color: null, description: null, sort_order: 0, is_active: true });
const OPTIONS = {
  mistake: ["Bez greške", "Pomerio stop"].map(item),
  exit_reason: ["Pogođen stop", "Zatvoreno ranije"].map(item),
  htf_bias: ["Bullish", "Bearish"].map(item),
  entry_tf: ["5m"].map(item),
} as unknown as OptionsMap;

const TRADE: TradePageTrade = {
  id: "00000000-0000-4000-8000-0000000000t1",
  label: "#3 MNQ",
  missed: false,
  accountName: "Combine 50K",
  currency: "USD",
  direction: "Short",
  qty: 1,
  avgEntry: 30584,
  avgExit: 30600.25,
  opened: "13/10 09:41",
  closed: "13/10 09:52",
  durationSeconds: 660,
  netPl: -33.72,
  realizedR: -0.81,
  fees: 1.22,
  maeR: 0.9,
  mfeR: 0.3,
  riskBudget: 300,
  pointValue: 2,
  fxRate: 1,
  tickSize: 0.25,
  stop: 30604,
  target: 30544,
  finalStop: null,
  stopNote: null,
  thesis: null,
  playbookId: PLAYBOOK.id,
  ruleAnswers: {},
  rating: null,
  notes: null,
  categories: { htf_bias: "Bearish", entry_tf: "5m", exit_reason: "Zatvoreno ranije", mistake: [] },
  plannedEntry: null,
  seenAt: null,
  timezone: "America/Chicago",
};

function renderPage(trade: TradePageTrade = TRADE, backHref = "/journal") {
  return render(
    <TradePage
      trade={trade}
      playbooks={[PLAYBOOK]}
      contextDefs={trade.missed ? [] : CONTEXT}
      reviewDefs={trade.missed ? [] : REVIEW}
      optionsMap={OPTIONS}
      breakevenRange={EXACT_ZERO_RANGE}
      backHref={backHref}
      images={null}
      scenario={null}
    />,
  );
}

beforeEach(() => {
  saveMock.mockReset().mockResolvedValue({ ok: true, id: TRADE.id });
  missedMock.mockReset().mockResolvedValue({ ok: true, id: TRADE.id });
  toastErrorMock.mockReset();
  pushMock.mockReset();
});

describe("TradePage — one page per imported trade (phase P)", () => {
  it("shows the fills as facts, never as inputs", () => {
    renderPage();
    expect(screen.getByText("#3 MNQ")).toBeInTheDocument();
    expect(screen.getByText("Combine 50K")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Ulaz$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Planned Entry|Position Size|Scale-out|Invalidation|Time stop/)).not.toBeInTheDocument();
  });

  it("saves the recording, the checklist, the grade and the categories in one call", async () => {
    const user = userEvent.setup();
    renderPage(TRADE, "/daily");
    await user.clear(screen.getByLabelText("Originalni stop (na ulazu)"));
    await user.type(screen.getByLabelText("Originalni stop (na ulazu)"), "30610");
    await user.type(screen.getByLabelText(/Šta sam rekao pre klika/), "Short iz gornje zone");
    await user.click(screen.getByText("Cena je u zoni pojasa"));
    await user.click(screen.getByRole("button", { name: /Prekršeno pravilo/ }));
    await user.click(screen.getByRole("button", { name: "Sačuvaj" }));

    expect(saveMock).toHaveBeenCalledWith(TRADE.id, {
      playbook_id: PLAYBOOK.id,
      execution_rating: 1,
      trade_journal_notes: "",
      images: [],
      stop_price: 30610,
      target_price: 30544,
      thesis: "Short iz gornje zone",
      categories: { htf_bias: "Bearish", entry_tf: "5m", exit_reason: "Zatvoreno ranije", mistake: [] },
      // Every offered rule is answered: the untouched one is "not kept".
      rule_answers: { [R1]: true, [R2]: false },
    });
    expect(missedMock).not.toHaveBeenCalled();
    expect(pushMock).toHaveBeenCalledWith("/daily");
  });

  it("records 'Bez greške' on an A and drops it again on a C", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: /Po planu — ulaz/ }));
    await user.click(screen.getByRole("button", { name: "Sačuvaj" }));
    expect(saveMock.mock.calls[0][1].categories.mistake).toEqual(["Bez greške"]);
    await user.click(screen.getByRole("button", { name: /Prekršeno pravilo/ }));
    await user.click(screen.getByRole("button", { name: "Sačuvaj" }));
    expect(saveMock.mock.calls[1][1].categories.mistake).toEqual([]);
  });

  it("asks for the original stop when it was moved", () => {
    renderPage({
      ...TRADE,
      stop: null,
      finalStop: 30584,
      stopNote: "Poslednji stop u platformi je na ulazu ili u profitu — pomeren je. Upiši originalni sa snimka.",
    });
    expect(screen.getByRole("alert")).toHaveTextContent("pomeren je");
    expect(screen.getByText(/Poslednji stop u platformi: 30.584,00|Poslednji stop u platformi: 30,584.00/)).toBeInTheDocument();
  });

  it("shows the context categories under their own labels", () => {
    renderPage();
    expect(screen.getByText("Bias dana (brief)")).toBeInTheDocument();
    expect(screen.getByText("Entry TF")).toBeInTheDocument();
  });
});

describe("TradePage — a missed setup", () => {
  const MISSED: TradePageTrade = {
    ...TRADE,
    missed: true,
    direction: "Long",
    qty: null,
    avgEntry: null,
    avgExit: null,
    netPl: null,
    realizedR: null,
    plannedEntry: 30500,
    stop: 30480,
    target: 30560,
    seenAt: "2026-10-13T08:15:00.000Z",
    categories: {},
  };

  it("saves the levels first, then the setup — without a grade", async () => {
    const user = userEvent.setup();
    renderPage(MISSED);
    expect(screen.queryByText("Po planu?")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sačuvaj" }));
    expect(missedMock).toHaveBeenCalledWith(MISSED.id, {
      direction: "Long",
      entry_price: 30500,
      stop_price: 30480,
      target_price: 30560,
      seen_at: "2026-10-13T08:15:00.000Z",
    });
    expect(saveMock.mock.calls[0][1]).toMatchObject({ execution_rating: null });
    expect(saveMock.mock.calls[0][1]).not.toHaveProperty("stop_price");
  });
});
