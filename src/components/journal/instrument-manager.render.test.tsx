import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InstrumentManager } from "./instrument-manager";
import type { Instrument } from "@/lib/journal/types";

/**
 * The instrument catalog as the trader works it: find a symbol among many,
 * correct a contract the broker defines differently, and never lose one to a
 * single click.
 *
 * The numbers are the reason this screen matters. `point_value` multiplies
 * every P&L on the symbol, so a field that saves something other than what was
 * typed is a wrong number on every trade — which is what `Number("0,5")` did
 * before `parseSettingsNumber`.
 */

const addInstrument = vi.fn();
const updateInstrument = vi.fn();
const deleteInstrument = vi.fn();
const countInstrumentUsage = vi.fn();

vi.mock("@/app/(app)/settings/actions", () => ({
  addInstrument: (...a: unknown[]) => addInstrument(...a),
  updateInstrument: (...a: unknown[]) => updateInstrument(...a),
  deleteInstrument: (...a: unknown[]) => deleteInstrument(...a),
  countInstrumentUsage: (...a: unknown[]) => countInstrumentUsage(...a),
}));
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: (m: string) => toastError(m) } }));

function inst(over: Partial<Instrument> = {}): Instrument {
  return {
    id: "i-gold",
    symbol: "XAUUSD",
    name: "Gold / US Dollar (spot)",
    asset_class: "Metals CFD",
    point_value: 1,
    tick_size: 0.001,
    tick_value: null,
    quote_currency: "USD",
    commission_per_lot: 0,
    commission_pct: 0.0007,
    commission_currency: "EUR",
    swap_long: -83,
    swap_short: -8.3,
    swap_triple_day: 3,
    is_active: true,
    sort_order: 200,
    ...over,
  };
}

const NAS = inst({
  id: "i-nas",
  symbol: "NAS100",
  name: "Nasdaq 100 (CFD)",
  asset_class: "Index CFD",
  tick_size: 0.25,
  sort_order: 301,
});

/** The row of one symbol, which is where its two inputs and its buttons live. */
function rowOf(symbol: string): HTMLElement {
  return screen.getByText(symbol).closest("div.grid") as HTMLElement;
}

beforeEach(() => {
  for (const m of [addInstrument, updateInstrument, deleteInstrument, countInstrumentUsage, toastError]) {
    m.mockReset();
  }
  updateInstrument.mockResolvedValue({ ok: true });
  deleteInstrument.mockResolvedValue({ ok: true });
  addInstrument.mockResolvedValue({ ok: true });
  countInstrumentUsage.mockResolvedValue({ ok: true, trades: 0 });
});

describe("finding a symbol", () => {
  it("filters by symbol, name or asset class", async () => {
    const user = userEvent.setup();
    render(<InstrumentManager instruments={[inst(), NAS]} />);

    await user.type(screen.getByLabelText("Search instruments"), "nasdaq");
    expect(screen.getByText("NAS100")).toBeInTheDocument();
    expect(screen.queryByText("XAUUSD")).not.toBeInTheDocument();
  });

  it("says so rather than showing an empty page", async () => {
    const user = userEvent.setup();
    render(<InstrumentManager instruments={[inst()]} />);

    await user.type(screen.getByLabelText("Search instruments"), "zzz");
    expect(screen.getByText("No instruments match.")).toBeInTheDocument();
  });
});

describe("the contract numbers", () => {
  it("labels the point value in the currency the symbol is quoted in", () => {
    render(<InstrumentManager instruments={[inst({ quote_currency: "EUR" })]} />);
    expect(screen.getByText("EUR / point")).toBeInTheDocument();
  });

  it("Save stays off until something actually changed", async () => {
    const user = userEvent.setup();
    render(<InstrumentManager instruments={[inst()]} />);

    const row = rowOf("XAUUSD");
    const save = within(row).getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();

    await user.clear(within(row).getByLabelText("USD / point"));
    await user.type(within(row).getByLabelText("USD / point"), "100");
    expect(save).toBeEnabled();

    await user.click(save);
    expect(updateInstrument).toHaveBeenCalledWith(
      "i-gold",
      expect.objectContaining({ point_value: 100, tick_size: 0.001 }),
    );
  });

  it("a tick of 0.001 is a thousandth, and saves", async () => {
    // It used to be refused as "Ambiguous — write 0001 or 0.001", so gold's
    // real tick could not be entered at all.
    const user = userEvent.setup();
    render(<InstrumentManager instruments={[inst({ tick_size: 1 })]} />);

    const row = rowOf("XAUUSD");
    const tick = within(row).getByLabelText("Tick");
    await user.clear(tick);
    await user.type(tick, "0.001");
    await user.click(within(row).getByRole("button", { name: "Save" }));

    expect(updateInstrument).toHaveBeenCalledWith(
      "i-gold",
      expect.objectContaining({ point_value: 1, tick_size: 0.001 }),
    );
  });

  it("names a number it cannot read, and refuses to save it", async () => {
    const user = userEvent.setup();
    render(<InstrumentManager instruments={[inst()]} />);

    const row = rowOf("XAUUSD");
    const pv = within(row).getByLabelText("USD / point");
    await user.clear(pv);
    await user.type(pv, "25.000");

    expect(within(row).getByText(/Ambiguous/)).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Save" })).toBeDisabled();
    expect(updateInstrument).not.toHaveBeenCalled();
  });
});

describe("deleting one", () => {
  it("asks first, and says how many trades are on the symbol", async () => {
    const user = userEvent.setup();
    countInstrumentUsage.mockResolvedValue({ ok: true, trades: 3 });
    render(<InstrumentManager instruments={[inst()]} />);

    await user.click(screen.getByRole("button", { name: "Delete XAUUSD" }));
    expect(deleteInstrument).not.toHaveBeenCalled();
    expect(await screen.findByText(/3 trades use it/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(deleteInstrument).toHaveBeenCalledWith("i-gold");
  });

  it("does not offer the button while it is still counting", async () => {
    const user = userEvent.setup();
    let release: (v: { ok: true; trades: number }) => void = () => {};
    countInstrumentUsage.mockReturnValue(new Promise((r) => (release = r)));
    render(<InstrumentManager instruments={[inst()]} />);

    await user.click(screen.getByRole("button", { name: "Delete XAUUSD" }));
    expect(await screen.findByText(/Checking which trades use it/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();

    release({ ok: true, trades: 0 });
    expect(await screen.findByText("No trade uses it.")).toBeInTheDocument();
  });

  it("a failed count is said out loud, not read as zero", async () => {
    const user = userEvent.setup();
    countInstrumentUsage.mockResolvedValue({ ok: false, error: "network" });
    render(<InstrumentManager instruments={[inst()]} />);

    await user.click(screen.getByRole("button", { name: "Delete XAUUSD" }));
    expect(await screen.findByText(/Could not count/)).toBeInTheDocument();
  });
});

describe("adding one the catalog does not carry", () => {
  it("uppercases the currency and sends the read numbers", async () => {
    const user = userEvent.setup();
    render(<InstrumentManager instruments={[]} />);

    await user.type(screen.getByLabelText("Symbol"), "xcuusd");
    await user.type(screen.getByLabelText("Name"), "Copper / US Dollar");
    const currency = screen.getByLabelText("Currency");
    await user.clear(currency);
    await user.type(currency, "usd");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(addInstrument).toHaveBeenCalledWith(
      expect.objectContaining({ quote_currency: "USD", point_value: 1 }),
    );
  });

  it("refuses a currency that is not a three-letter code", async () => {
    // The box also caps at three characters, so this is what a wrong one looks
    // like in practice: too few, or not letters.
    const user = userEvent.setup();
    render(<InstrumentManager instruments={[]} />);

    await user.type(screen.getByLabelText("Symbol"), "XCUUSD");
    const currency = screen.getByLabelText("Currency");
    await user.clear(currency);
    await user.type(currency, "us");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(addInstrument).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("Currency is a three-letter code, like USD.");
  });

  it("Add is off while the symbol is empty", () => {
    render(<InstrumentManager instruments={[]} />);
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
  });
});

describe("what the broker charges", () => {
  it("saves the commission and the swap alongside the contract spec", async () => {
    const user = userEvent.setup({ delay: null });
    updateInstrument.mockResolvedValue({ ok: true });
    render(<InstrumentManager instruments={[inst()]} />);

    const row = rowOf("XAUUSD");
    const swapLong = within(row).getByLabelText("Swap L");
    await user.clear(swapLong);
    await user.type(swapLong, "-90");
    await user.click(within(row).getByRole("button", { name: "Save" }));

    await vi.waitFor(() =>
      expect(updateInstrument).toHaveBeenCalledWith(
        "i-gold",
        expect.objectContaining({ swap_long: -90, commission_pct: 0.0007 }),
      ),
    );
  });

  it("says which side is charged and which night is tripled", () => {
    render(<InstrumentManager instruments={[inst()]} />);
    expect(screen.getByText(/charged three times on Wednesday/)).toBeInTheDocument();
  });

  it("refuses a swap it cannot read, instead of saving a zero", async () => {
    const user = userEvent.setup({ delay: null });
    render(<InstrumentManager instruments={[inst()]} />);

    const row = rowOf("XAUUSD");
    const swapShort = within(row).getByLabelText("Swap S");
    await user.clear(swapShort);
    await user.type(swapShort, "abc");

    expect(within(row).getByRole("button", { name: "Save" })).toBeDisabled();
    expect(updateInstrument).not.toHaveBeenCalled();
  });
});
