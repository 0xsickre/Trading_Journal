import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BiasPanel } from "./bias-panel";
import { parseDailyBias, type DailyBias } from "@/lib/journal/daily-bias";
import type { TradeRow } from "@/lib/journal/types";

vi.mock("next/dynamic", () => ({ default: () => () => <div data-testid="bias-chart" /> }));

const b = (day: string, bias: string, move: number, evalDay: string, root = "NQ") =>
  parseDailyBias({
    id: `${day}-${root}`,
    trading_day: day,
    root,
    bias,
    reason: null,
    set_at: `${day}T05:00:00Z`,
    eval_status: "ok",
    eval_start_at: `${day}T07:00:00Z`,
    eval_start_price: 100,
    eval_end_price: 100 + move,
    eval_move: move,
    eval_band: 20,
    eval_day: evalDay,
  }) as DailyBias;

const trade = (over: Record<string, unknown>) =>
  ({
    id: "t1",
    account_id: "a",
    status: "closed",
    instrument: "MNQ",
    direction: "Long",
    stats: { opened_at: "2026-10-19T08:00:00Z", net_pl: 120, realized_r: 1.2 },
    ...over,
  }) as unknown as TradeRow;

const zone = () => "Europe/Belgrade";

describe("BiasPanel", () => {
  it("is not there without a single forecast", () => {
    const { container } = render(<BiasPanel biases={[]} trades={[]} zoneOf={zone} currency="USD" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("puts my winrate beside always-long on the same days, with points and the real money", () => {
    render(
      <BiasPanel
        biases={[b("2026-10-19", "gore", 142, "gore"), b("2026-10-20", "dole", -90, "dole"), b("2026-10-21", "gore", 10, "neutral")]}
        trades={[trade({}), trade({ id: "t2", direction: "Short", stats: { opened_at: "2026-10-19T09:00:00Z", net_pl: -40, realized_r: -1 } })]}
        zoneOf={zone}
        currency="USD"
      />,
    );
    expect(screen.getByText("67 % (2/3)")).toBeInTheDocument();
    expect(screen.getByText("33 % (1/3)")).toBeInTheDocument();
    expect(screen.getByText("+33 p.p.")).toBeInTheDocument();
    expect(screen.getByText("+242 / +62")).toBeInTheDocument();
    expect(screen.getByText(/Mali uzorak: 3 od 30/)).toBeInTheDocument();
    expect(screen.getByTestId("bias-chart")).toBeInTheDocument();
    expect(screen.getByText("U smeru biasa").closest("tr")).toHaveTextContent("+1.20R");
    expect(screen.getByText("Protiv biasa").closest("tr")).toHaveTextContent("-1.00R");
  });
});
