import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InstrumentSelect } from "./instrument-select";
import type { Instrument } from "@/lib/journal/types";

/**
 * The catalog is ninety-odd symbols. The grouped `Select` this replaces
 * rendered all of them and left finding one to scrolling: Radix's type-to-jump
 * matches the start of a label, so a trader who thinks "gold" rather than
 * "XAUUSD" had nothing to type. These tests hold what fixes that — typing
 * filters on the name as well as the symbol — and the two things that made the
 * old field worth keeping: the class grouping, and the chosen instrument
 * staying visible.
 */

function inst(over: Partial<Instrument> & { id: string; symbol: string }): Instrument {
  return {
    name: null,
    asset_class: "Forex",
    point_value: 1,
    tick_size: null,
    tick_value: null,
    quote_currency: "USD",
    is_active: true,
    sort_order: 0,
    ...over,
  } as Instrument;
}

const CATALOG: Instrument[] = [
  inst({ id: "1", symbol: "EURUSD", name: "Euro / US Dollar", asset_class: "Forex" }),
  inst({ id: "2", symbol: "XAUUSD", name: "Gold / US Dollar (spot)", asset_class: "Metals CFD" }),
  inst({ id: "3", symbol: "NAS100", name: "Nasdaq 100 (CFD)", asset_class: "Index CFD" }),
  inst({ id: "4", symbol: "GC", name: "Gold Futures", asset_class: "Metals Futures" }),
];

function draw(value = "") {
  const onChange = vi.fn();
  render(<InstrumentSelect instruments={CATALOG} value={value} onChange={onChange} />);
  return { onChange };
}

const field = () => screen.getByRole("textbox");

describe("picking an instrument by typing", () => {
  it("shows the chosen symbol and its name, not a placeholder", () => {
    draw("XAUUSD");
    expect(screen.getByText("XAUUSD — Gold / US Dollar (spot)")).toBeInTheDocument();
  });

  it("filters on the NAME, which the old list could not do", async () => {
    const user = userEvent.setup();
    draw();
    await user.type(field(), "gold");

    expect(await screen.findByText("XAUUSD")).toBeInTheDocument();
    expect(screen.getByText("GC")).toBeInTheDocument();
    expect(screen.queryByText("EURUSD")).not.toBeInTheDocument();
  });

  it("keeps the asset-class grouping when nothing is typed", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(field());

    expect(await screen.findByText("Forex")).toBeInTheDocument();
    expect(screen.getByText("Metals CFD")).toBeInTheDocument();
    expect(screen.getByText("Index CFD")).toBeInTheDocument();
  });

  it("reports the symbol when a row is clicked", async () => {
    const user = userEvent.setup();
    const { onChange } = draw();
    await user.type(field(), "nas");
    await user.click(await screen.findByText("NAS100"));

    expect(onChange).toHaveBeenCalledWith("NAS100");
  });

  it("Enter takes the only match, so a symbol is typed and done", async () => {
    const user = userEvent.setup();
    const { onChange } = draw();
    await user.type(field(), "eurusd{Enter}");

    expect(onChange).toHaveBeenCalledWith("EURUSD");
  });

  it("Enter with several matches picks nothing — a guess is not a choice", async () => {
    const user = userEvent.setup();
    const { onChange } = draw();
    await user.type(field(), "gold{Enter}");

    expect(onChange).not.toHaveBeenCalled();
  });

  it("says so when nothing matches, rather than showing an empty list", async () => {
    const user = userEvent.setup();
    draw();
    await user.type(field(), "zzz");

    expect(await screen.findByText(/Nothing matches/)).toBeInTheDocument();
  });

  it("clears the trade's instrument on the X", async () => {
    const user = userEvent.setup();
    const { onChange } = draw("XAUUSD");
    await user.click(screen.getByTitle("Clear"));

    expect(onChange).toHaveBeenCalledWith("");
  });
});
