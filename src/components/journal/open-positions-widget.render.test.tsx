import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { OpenPositionsWidget } from "./open-positions-widget";
import type { TradeRow } from "@/lib/journal/types";

/** An open MNQ long: 10 contracts, 10 points to the stop at $1 a point = $100 at risk. */
const open = {
  id: "11111111-1111-1111-1111-111111111111",
  account_id: "ts",
  trade_no: 7,
  instrument: "MNQ",
  direction: "Long",
  status: "open",
  entry_price: 100,
  stop_price: 90,
  created_at: "2026-09-29T14:00:00Z",
  stats: {
    position_id: "11111111-1111-1111-1111-111111111111",
    avg_entry: 100,
    entry_qty: 10,
    exit_qty: 0,
    point_value: 1,
    fx_rate: 1,
    opened_at: "2026-09-29T14:00:00Z",
    closed_at: null,
  },
} as unknown as TradeRow;

describe("OpenPositionsWidget — open risk, with no prop firm's limit (phase X)", () => {
  it("shows the open risk against equity and names no DLL", () => {
    render(
      <OpenPositionsWidget
        rows={[open]}
        tzOf={() => "UTC"}
        now={Date.parse("2026-09-29T14:10:00Z")}
        equityOf={() => 50_000}
      />,
    );
    expect(screen.getByText("0.20%")).toBeInTheDocument();
    expect(screen.queryByText(/DLL/)).not.toBeInTheDocument();
  });
});
