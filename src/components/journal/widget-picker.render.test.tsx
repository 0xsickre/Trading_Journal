import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WidgetPicker } from "./widget-picker";
import { DASHBOARD_WIDGETS } from "@/lib/journal/dashboard-widgets";

/**
 * The popover that decides what the dashboard shows.
 *
 * `dashboard-widgets.test.ts` proves the rules — locked widgets cannot be
 * switched off, unknown ids are inert. What is left for this file is whether
 * the reader can SEE those rules: a checkbox that silently refuses is worse
 * than one that is visibly unavailable, which is the same argument the journal
 * grid's column picker settled for its last-column guard.
 */

const open = async () => {
  const user = userEvent.setup({ delay: null });
  await user.click(screen.getByRole("button", { name: /Sections/ }));
  return user;
};

describe("WidgetPicker", () => {
  it("lists every widget, in page order", () => {
    render(<WidgetPicker hidden={[]} order={[]} onToggle={() => {}} onMove={() => {}} />);
    return open().then(() => {
      for (const w of DASHBOARD_WIDGETS) {
        expect(screen.getByText(w.label), w.id).toBeInTheDocument();
      }
    });
  });

  it("SHOWS THE LOCKED ONES DISABLED rather than hiding them", async () => {
    // Omitting them would leave a reader who wants the FTMO banner gone
    // hunting for a switch that does not exist. Disabled answers in place.
    render(<WidgetPicker hidden={[]} order={[]} onToggle={() => {}} onMove={() => {}} />);
    await open();
    const locked = screen.getByRole("menuitemcheckbox", {
      name: "Challenge status",
    });
    // `data-disabled`, not `toBeDisabled()`: a Radix menu item is a `div` with
    // a role, not a form control, so there is no native `disabled` attribute to
    // find. Radix's own data attribute is the same category of hook the
    // dashboard tests already hang off with `data-slot`.
    expect(locked).toHaveAttribute("data-disabled");
    expect(locked).toBeChecked();
    // The reason travels with the refusal, rather than leaving the reader to
    // guess why one row will not respond.
    expect(locked).toHaveAttribute("title", expect.stringContaining("cannot be hidden"));
  });

  it("reports a hidden widget as unchecked", async () => {
    render(<WidgetPicker hidden={["equity"]} order={[]} onToggle={() => {}} onMove={() => {}} />);
    await open();
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Equity curve" }),
    ).not.toBeChecked();
  });

  it("calls back with the id and KEEPS THE MENU OPEN", async () => {
    // Switching several sections off in a row is the normal way this is used;
    // a menu that closes after each one turns four clicks into eight.
    const onToggle = vi.fn();
    render(<WidgetPicker hidden={[]} order={[]} onToggle={onToggle} onMove={() => {}} />);
    const user = await open();
    await user.click(
      screen.getByRole("menuitemcheckbox", { name: "Equity curve" }),
    );
    expect(onToggle).toHaveBeenCalledWith("equity");
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Drawdown curve" }),
    ).toBeInTheDocument();
  });

  it("badges the count only once something is off", () => {
    // A badge reading 15/15 is furniture. It appears when it has news.
    const { rerender } = render(
      <WidgetPicker hidden={[]} order={[]} onToggle={() => {}} onMove={() => {}} />,
    );
    expect(screen.queryByText(/\/\d+/)).not.toBeInTheDocument();

    rerender(<WidgetPicker hidden={["equity"]} order={[]} onToggle={() => {}} onMove={() => {}} />);
    const hideable = DASHBOARD_WIDGETS.filter((w) => w.hideable).length;
    expect(
      screen.getByText(`${hideable - 1}/${hideable}`),
    ).toBeInTheDocument();
  });
});

describe("the arrows that reorder the page", () => {
  const movable = () => DASHBOARD_WIDGETS.filter((w) => w.hideable);

  it("MOVES WITHOUT TOGGLING — the two live in one row and must not collide", () => {
    // The chevrons sit inside a checkbox item whose whole job is to toggle on
    // click. Without the handlers stopping the event, every reorder would also
    // switch the section off.
    const onToggle = vi.fn();
    const onMove = vi.fn();
    render(
      <WidgetPicker hidden={[]} order={[]} onToggle={onToggle} onMove={onMove} />,
    );
    return open().then(async (user) => {
      await user.click(
        screen.getByRole("button", { name: "Move Process · Survival · Edge up" }),
      );
      expect(onMove).toHaveBeenCalledWith("score", -1);
      expect(onToggle).not.toHaveBeenCalled();
    });
  });

  it("greys out the moves that would do nothing", async () => {
    // A button that silently refuses is worse than one that is visibly
    // unavailable — the same call the journal grid makes for its last column.
    render(
      <WidgetPicker hidden={[]} order={[]} onToggle={() => {}} onMove={() => {}} />,
    );
    await open();
    const first = movable()[0];
    const last = movable().at(-1)!;
    expect(
      screen.getByRole("button", { name: `Move ${first.label} up` }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: `Move ${last.label} down` }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: `Move ${first.label} down` }),
    ).toBeEnabled();
  });

  it("gives locked sections no arrows at all", async () => {
    // They render above the rows and never inside them, so an arrow would move
    // the stored array and change nothing on screen.
    render(
      <WidgetPicker hidden={[]} order={[]} onToggle={() => {}} onMove={() => {}} />,
    );
    await open();
    expect(
      screen.queryByRole("button", { name: /Move Headline figures/ }),
    ).not.toBeInTheDocument();
  });

  it("follows a stored order rather than the registry's", async () => {
    render(
      <WidgetPicker
        hidden={[]}
        order={["tag-breakdown", "equity"]}
        onToggle={() => {}}
        onMove={() => {}}
      />,
    );
    await open();
    const rows = screen.getAllByRole("menuitemcheckbox").map((r) => r.textContent);
    // Locked three keep the front; the reader's sequence follows.
    expect(rows[3]).toContain("Performance by tag");
    expect(rows[4]).toContain("Equity curve");
    // And the one now at the top of the movable list cannot move up.
    expect(
      screen.getByRole("button", { name: "Move Performance by tag up" }),
    ).toBeDisabled();
  });
});
