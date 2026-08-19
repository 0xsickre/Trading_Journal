import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StarRating } from "./star-rating";

/**
 * The rating control, and the one distinction it exists to defend.
 *
 * `20260801180000_drop_position_rating` deleted the previous attempt at this
 * column because nothing ever wrote to it. What that migration asked for on the
 * way back was "a UI that actually sets it" — so these tests are about setting
 * and, more importantly, UNSETTING.
 */

describe("StarRating", () => {
  it("reports the star that was clicked", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup({ delay: null });
    render(<StarRating value={null} onChange={onChange} />);

    await user.click(screen.getByRole("radio", { name: "4 of 5" }));
    expect(onChange).toHaveBeenCalledWith(4);
  });

  it("CLEARS BACK TO NULL when the set star is clicked again", async () => {
    // Without a way back, one misclick is permanently a 1-star trade, and the
    // report fills with ratings nobody meant. "Not rated" is not "rated 1", and
    // this is the only control that can express the difference.
    const onChange = vi.fn();
    const user = userEvent.setup({ delay: null });
    render(<StarRating value={4} onChange={onChange} />);

    await user.click(screen.getByRole("radio", { name: "4 of 5" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("marks exactly one star as checked", () => {
    render(<StarRating value={3} onChange={() => {}} />);
    const checked = screen
      .getAllByRole("radio")
      .filter((el) => el.getAttribute("aria-checked") === "true");
    expect(checked).toHaveLength(1);
    expect(checked[0]).toHaveAttribute("aria-label", "3 of 5");
  });

  it("checks nothing at all when the trade is unrated", () => {
    // Distinct from the case above rather than a variation of it: an unrated
    // trade must not read as a 1, and `aria-checked` is where a screen reader
    // would learn otherwise.
    render(<StarRating value={null} onChange={() => {}} />);
    expect(
      screen.getAllByRole("radio").filter((el) => el.getAttribute("aria-checked") === "true"),
    ).toHaveLength(0);
  });

  it("offers an explicit Clear only once there is something to clear", () => {
    const { rerender } = render(<StarRating value={null} onChange={() => {}} />);
    expect(screen.queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();

    rerender(<StarRating value={2} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();
  });
});
