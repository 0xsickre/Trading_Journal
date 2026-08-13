import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
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

  it("keeps the mobile switch OUT of the horizontally scrolling nav strip", () => {
    // Pinned rather than appended: nine entries overflow a phone, so anything
    // inside the scroller sits past the right edge until the user scrolls a
    // strip they have no reason to scroll to the end of.
    const { container } = render(<MobileTopbar />);
    const scroller = container.querySelector(".overflow-x-auto")!;
    expect(scroller).toBeTruthy();
    expect(
      within(scroller as HTMLElement).queryByRole("group", { name: "Theme" }),
    ).toBeNull();
  });
});

describe("both chromes render the whole menu", () => {
  it.each([
    ["sidebar", () => render(<AppSidebar email={null} />)],
    ["mobile top bar", () => render(<MobileTopbar />)],
  ])("%s lists every nav item and the primary action", (_name, mount) => {
    mount();
    for (const item of NAV_ITEMS) {
      expect(
        screen.getByRole("link", { name: new RegExp(item.label) }),
      ).toHaveAttribute("href", item.href);
    }
    expect(
      screen.getByRole("link", { name: new RegExp(PRIMARY_ACTION.label) }),
    ).toHaveAttribute("href", PRIMARY_ACTION.href);
  });
});
