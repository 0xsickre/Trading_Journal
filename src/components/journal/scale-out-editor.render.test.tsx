import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ScaleOutEditor } from "./scale-out-editor";

/**
 * The editor. The arithmetic it shows is proved in `scale-out.test.ts`; what is
 * left here is what a reader actually depends on — that the derived R column
 * follows entry and stop rather than being typed, and that going over 100 % is
 * visible before the save is attempted.
 */

const LONG = { direction: "Long", entry: 100, stop: 90 };
const row = (pct: string, price: string) => ({ pct, price });

describe("ScaleOutEditor", () => {
  it("says so when there is nothing planned yet", () => {
    render(<ScaleOutEditor rows={[]} onChange={() => {}} {...LONG} />);
    expect(screen.getByText(/No levels yet/)).toBeInTheDocument();
  });

  it("DERIVES THE R COLUMN from entry and stop rather than asking for it", () => {
    // Price in, R out. Storing R instead would let an edited stop leave a
    // saved number that is no longer true — the thing this repo refuses to do.
    // 110 against a 10-point stop is 1R; 120 is 2R.
    render(
      <ScaleOutEditor
        rows={[row("60", "110"), row("40", "120")]}
        onChange={() => {}}
        {...LONG}
      />,
    );
    expect(screen.getByText("1.00R")).toBeInTheDocument();
    expect(screen.getByText("2.00R")).toBeInTheDocument();
  });

  it("shows a dash, not a zero, while the price is still blank", () => {
    render(<ScaleOutEditor rows={[row("60", "")]} onChange={() => {}} {...LONG} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("runs a live total so 100 % is not something you discover on save", () => {
    render(
      <ScaleOutEditor
        rows={[row("60", "110"), row("40", "120")]}
        onChange={() => {}}
        {...LONG}
      />,
    );
    expect(screen.getByText(/Total: 100% · Remaining: 0%/)).toBeInTheDocument();
  });

  it("COLOURS THE TOTAL AS A LOSS once it exceeds the position", () => {
    // 120 % is not a plan, it is arithmetic that cannot happen. The submit
    // guard refuses it, but the number has to look wrong before that.
    render(
      <ScaleOutEditor
        rows={[row("60", "110"), row("60", "120")]}
        onChange={() => {}}
        {...LONG}
      />,
    );
    expect(screen.getByText(/Total: 120%/).className).toContain("var(--loss)");
  });

  it("adds and removes rows", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup({ delay: null });
    const { rerender } = render(
      <ScaleOutEditor rows={[]} onChange={onChange} {...LONG} />,
    );

    await user.click(screen.getByRole("button", { name: "Add level" }));
    expect(onChange).toHaveBeenCalledWith([{ pct: "", price: "" }]);

    rerender(
      <ScaleOutEditor rows={[row("60", "110")]} onChange={onChange} {...LONG} />,
    );
    await user.click(screen.getByRole("button", { name: "Remove level 1" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});
