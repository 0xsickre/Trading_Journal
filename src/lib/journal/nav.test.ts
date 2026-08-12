import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NAV_ITEMS, NAV_SECTIONS, PRIMARY_ACTION } from "./nav";

/**
 * THE MENU AGAINST THE ROUTES THAT ACTUALLY EXIST.
 *
 * A dead entry in the sidebar is invisible until someone clicks it and lands on
 * a 404 — there is no type error, no failing build, and no other test in this
 * repo looks at navigation at all. Reordering the menu into sections is exactly
 * the kind of edit that can drop or mistype an `href`, so the guard goes in with
 * it rather than after the first broken link.
 *
 * The check is against the filesystem, not against a hardcoded list of routes:
 * a second list would need updating whenever a route is added, and a stale copy
 * of the truth is what this file exists to prevent.
 */
const APP_DIR = fileURLToPath(new URL("../../app/(app)", import.meta.url));

/** `/reports` → `src/app/(app)/reports/page.tsx`; `/` → `src/app/(app)/page.tsx`. */
function routeFileFor(href: string): string {
  const segment = href === "/" ? "" : href;
  return `${APP_DIR}${segment}/page.tsx`;
}

describe("every navigation target resolves to a real route", () => {
  it.each(NAV_ITEMS.map((i) => [i.label, i.href] as const))(
    "%s → %s",
    (_label, href) => {
      expect(existsSync(routeFileFor(href))).toBe(true);
    },
  );

  it("the primary action points at a real route too", () => {
    expect(existsSync(routeFileFor(PRIMARY_ACTION.href))).toBe(true);
  });
});

describe("the flat list stays a projection of the sections", () => {
  it("is the sections concatenated, in order", () => {
    // Not a length check: the mobile strip and the sidebar must agree on ORDER,
    // and two lists of the same size can still disagree about it.
    expect(NAV_ITEMS).toEqual(NAV_SECTIONS.flatMap((s) => s.items));
  });

  it("lists no route twice", () => {
    const hrefs = NAV_ITEMS.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("keeps the primary action out of the list it sits above", () => {
    // It used to be the seventh entry AND a button on two pages. Having it in
    // both places again is the regression this asserts against.
    expect(NAV_ITEMS.map((i) => i.href)).not.toContain(PRIMARY_ACTION.href);
  });

  it("gives every section at least one entry", () => {
    for (const s of NAV_SECTIONS) expect(s.items.length).toBeGreaterThan(0);
  });
});
