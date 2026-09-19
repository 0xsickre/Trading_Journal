import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppSidebar, MobileTopbar } from "./app-sidebar";
import { NAV_ITEMS, PRIMARY_ACTION } from "@/lib/journal/nav";

/**
 * THE CHROME, ON BOTH BREAKPOINTS.
 *
 * `nav.test.ts` proves every menu entry points at a route that exists. This
 * file proves the entries — and the theme switch — are actually RENDERED, which
 * is a different claim and the one that broke: the switch went into `AppSidebar`
 * only, and `AppSidebar` is `hidden … md:flex`, so on a phone it was nowhere.
 * Tailwind's responsive classes are invisible to jsdom, so the guard cannot be
 * "does it look right at 375px" — it has to be "does each of the two chrome
 * components contain one".
 *
 * `usePathname` and the logout action are mocked because neither is what these
 * components are responsible for; the router and the server action have their
 * own homes.
 */
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("@/app/login/actions", () => ({ logout: vi.fn() }));

describe("the theme switch is reachable on every breakpoint", () => {
  it("the desktop sidebar carries one", () => {
    render(<AppSidebar email="t@example.com" />);
    expect(screen.getByRole("group", { name: "Theme" })).toBeInTheDocument();
  });

  it("the mobile top bar carries one too — the bug this file was added for", () => {
    render(<MobileTopbar />);
    expect(screen.getByRole("group", { name: "Theme" })).toBeInTheDocument();
  });

  it("keeps the mobile switch reachable WITHOUT opening the nav menu", () => {
    // Same invariant as before the strip became a menu, restated for the new
    // shape: the switch must not be one of the things you have to go looking
    // for. Previously that meant "not inside the scroller"; now it means "not
    // behind the trigger".
    render(<MobileTopbar />);
    const bar = screen.getByRole("group", { name: "Theme" });
    expect(bar).toBeInTheDocument();
    // The primary action is held to the same rule.
    expect(
      screen.getByRole("link", { name: new RegExp(PRIMARY_ACTION.label) }),
    ).toHaveAttribute("href", PRIMARY_ACTION.href);
  });
});

describe("the AGPL source offer is reachable on every breakpoint", () => {
  /**
   * Same invariant as the theme switch above, for a different reason: § 13
   * requires the offer to reach ALL users, and the desktop sidebar is
   * `hidden … md:flex`. A link placed only there satisfies the licence for
   * nobody on a phone.
   *
   * Only the href is asserted, not the commit in it. Under test
   * `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA` is unset, so the fallback is what
   * renders; pinning is Vercel's half of it and cannot be proven from jsdom.
   */
  const REPO = "https://github.com/0xsickre/Trading_Journal";

  it("the desktop sidebar carries the offer", () => {
    render(<AppSidebar email="t@example.com" />);
    expect(
      screen.getByRole("link", { name: /Source code/ }),
    ).toHaveAttribute("href", REPO);
  });

  it("the mobile menu carries it too", async () => {
    const user = userEvent.setup({ delay: null });
    render(<MobileTopbar />);
    await user.click(screen.getByRole("button", { name: /Dashboard|Menu/ }));
    expect(
      screen.getByRole("menuitem", { name: /Source code/ }),
    ).toHaveAttribute("href", REPO);
  });
});

describe("both chromes render the whole menu", () => {
  /**
   * Every nav entry resolves to its own route, wherever the chrome puts it.
   *
   * The role differs by chrome and that is not incidental: inside the dropdown
   * the entries are `DropdownMenuItem asChild`, and Radix stamps
   * `role="menuitem"` onto the `<Link>`, which overrides its implicit link
   * role. The element is still an anchor with an href — which is what is
   * actually being asserted.
   */
  function expectEveryNavLink(role: "link" | "menuitem") {
    for (const item of NAV_ITEMS) {
      expect(
        screen.getByRole(role, { name: new RegExp(item.label) }),
      ).toHaveAttribute("href", item.href);
    }
  }

  it("the sidebar lists every nav item and the primary action", () => {
    render(<AppSidebar email={null} />);
    expectEveryNavLink("link");
    expect(
      screen.getByRole("link", { name: new RegExp(PRIMARY_ACTION.label) }),
    ).toHaveAttribute("href", PRIMARY_ACTION.href);
  });

  it("the mobile menu lists every nav item once opened", async () => {
    // The strip rendered all nine inline; the menu renders them on open. The
    // assertion is unchanged — only the step before it is new.
    const user = userEvent.setup({ delay: null });
    render(<MobileTopbar />);
    await user.click(screen.getByRole("button", { name: /Dashboard|Menu/ }));
    expectEveryNavLink("menuitem");
  });

  it("the mobile trigger names the page you are on", () => {
    // `usePathname` is mocked to "/", which is Dashboard.
    render(<MobileTopbar />);
    expect(
      screen.getByRole("button", { name: /Dashboard/ }),
    ).toBeInTheDocument();
  });
});

describe("the desktop sidebar hides until the pointer reaches the left edge", () => {
  afterEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  const aside = () => screen.getByRole("complementary");

  it("starts hidden, slides in at the edge, and slides away after the pointer leaves", () => {
    vi.useFakeTimers();
    render(<AppSidebar email="t@example.com" />);
    expect(aside()).toHaveAttribute("data-state", "closed");

    fireEvent.mouseEnter(screen.getByTestId("sidebar-edge"));
    expect(aside()).toHaveAttribute("data-state", "open");

    // A short grace period, so crossing the border on the way to a link does
    // not shut it.
    fireEvent.mouseLeave(aside());
    fireEvent.mouseEnter(aside());
    act(() => vi.advanceTimersByTime(500));
    expect(aside()).toHaveAttribute("data-state", "open");

    fireEvent.mouseLeave(aside());
    act(() => vi.advanceTimersByTime(500));
    expect(aside()).toHaveAttribute("data-state", "closed");
  });

  it("opens for keyboard focus too, so it is never out of reach", () => {
    render(<AppSidebar email="t@example.com" />);
    fireEvent.focus(screen.getByRole("button", { name: /Pin sidebar open/ }));
    expect(aside()).toHaveAttribute("data-state", "open");
  });

  it("the pin keeps it in the layout, and the browser remembers it", async () => {
    const user = userEvent.setup({ delay: null });
    const { unmount } = render(<AppSidebar email="t@example.com" />);
    await user.click(screen.getByRole("button", { name: /Pin sidebar open/ }));
    expect(aside()).toHaveAttribute("data-state", "pinned");
    expect(screen.queryByTestId("sidebar-edge")).not.toBeInTheDocument();
    // Bottom-fixed bars start past a pinned sidebar, and at the edge otherwise.
    const offset = () => document.documentElement.style.getPropertyValue("--sidebar-offset");
    expect(offset()).toBe("15rem");
    unmount();

    render(<AppSidebar email="t@example.com" />);
    expect(aside()).toHaveAttribute("data-state", "pinned");
    await user.click(screen.getByRole("button", { name: /Unpin sidebar/ }));
    expect(aside()).toHaveAttribute("data-state", "closed");
    expect(offset()).toBe("0px");
  });
});
