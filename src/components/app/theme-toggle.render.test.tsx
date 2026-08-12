import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeToggle } from "./theme-toggle";

/**
 * The switch, against the contract `next-themes` actually offers.
 *
 * `useTheme` is mocked rather than wrapping the real provider: the provider
 * reads `localStorage` and `matchMedia` and writes to `document.documentElement`,
 * none of which is what this component is responsible for. What IS its
 * responsibility is that each button sets the theme it names, and that the
 * highlight follows the active one — which is where a three-way switch usually
 * goes wrong (two buttons highlighted, or "system" silently mapped to "dark").
 */
const setTheme = vi.fn();
let theme: string | undefined = "dark";

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme, setTheme, themes: ["light", "dark", "system"] }),
}));

beforeEach(() => {
  setTheme.mockClear();
  theme = "dark";
});

describe("ThemeToggle — three choices, one of them selected", () => {
  it("offers light, dark and system", () => {
    render(<ThemeToggle />);
    for (const name of ["Light", "Dark", "System"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("marks exactly the active theme as pressed, and only it", () => {
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // The bug this guards: an `active` derived from something other than the
    // theme itself lights up more than one, and the row stops meaning anything.
    const pressed = screen
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-pressed") === "true");
    expect(pressed).toHaveLength(1);
  });

  it("each button sets the theme it is named after", async () => {
    const user = userEvent.setup({ delay: null });
    render(<ThemeToggle />);

    await user.click(screen.getByRole("button", { name: "Light" }));
    expect(setTheme).toHaveBeenCalledWith("light");

    await user.click(screen.getByRole("button", { name: "System" }));
    expect(setTheme).toHaveBeenCalledWith("system");
  });

  it("selects nothing rather than guessing while the theme is unknown", () => {
    // `useTheme()` answers undefined until the provider has read storage. The
    // row must show no selection then — highlighting a default would tell the
    // reader they had chosen something they had not.
    theme = undefined;
    render(<ThemeToggle />);
    const pressed = screen
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-pressed") === "true");
    expect(pressed).toHaveLength(0);
  });
});
