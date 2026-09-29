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

const widget = (dllLeft: number | null) =>
  render(
    <OpenPositionsWidget
      rows={[open]}
      tzOf={() => "UTC"}
      now={Date.parse("2026-09-29T14:10:00Z")}
      equityOf={() => 50_000}
      dllLeftOf={() => dllLeft}
    />,
  );

describe("OpenPositionsWidget — open risk against the DLL (F5.5)", () => {
  it("says what share of today's DLL the open stops would take", () => {
    widget(400);
    expect(screen.getByText("25% of DLL left ($400.00)")).toBeInTheDocument();
  });

  it("says so when no DLL is left today", () => {
    widget(0);
    expect(screen.getByText("no DLL left today")).toBeInTheDocument();
  });

  it("has no DLL figure on an account outside Topstep mode", () => {
    widget(null);
    expect(screen.queryByText(/DLL/)).not.toBeInTheDocument();
  });
});
