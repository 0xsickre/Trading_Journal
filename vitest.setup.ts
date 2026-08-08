import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

/**
 * Browser APIs jsdom does not implement, and who actually needs each one.
 *
 * Every shim here is named with its consumer on purpose. A shim with no stated
 * reason is a shim nobody can ever delete: the day a library is dropped, the
 * next reader has no way to know whether the polyfill went with it. If one of
 * these turns out to be unnecessary, the comment is what makes removing it a
 * five-minute check instead of a guess.
 *
 * None of these change component behaviour. They exist so that rendering does
 * not THROW, which is the only thing standing between this suite and the 16 250
 * lines of components that round 3 could review but never execute.
 */

/**
 * Radix (Select, Popover, Dialog, DropdownMenu — 21 of 43 journal components)
 * and recharts both observe element size. jsdom has no layout engine, so it
 * ships no ResizeObserver at all and the constructor is simply undefined.
 */
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

/**
 * Radix positions floating layers from `getBoundingClientRect`. jsdom answers
 * with an all-zero rect, which is survivable, but `DOMRect` itself is missing
 * and some paths construct one.
 */
globalThis.DOMRect ??= class {
  constructor(
    readonly x = 0,
    readonly y = 0,
    readonly width = 0,
    readonly height = 0,
  ) {}
  get top() { return this.y; }
  get left() { return this.x; }
  get right() { return this.x + this.width; }
  get bottom() { return this.y + this.height; }
  toJSON() { return { ...this }; }
  static fromRect(r?: DOMRectInit) {
    return new DOMRect(r?.x, r?.y, r?.width, r?.height);
  }
} as unknown as typeof DOMRect;

/**
 * Radix Select scrolls the highlighted item into view when a listbox opens.
 * jsdom defines the method as a no-op on some versions and not at all on
 * others; assigning unconditionally is the stable option.
 */
Element.prototype.scrollIntoView = vi.fn();

/**
 * Pointer capture, used by Radix to keep a drag inside the element it started
 * in. jsdom implements the events but none of the three capture methods, so
 * opening a Select throws `hasPointerCapture is not a function`.
 */
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};

/**
 * `next-themes`, reached through the shadcn `sonner` wrapper.
 */
globalThis.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof matchMedia;

/**
 * CSV and XLSX export in `dashboard.tsx:790` and `journal-grid.tsx:847`.
 * jsdom has `URL` but not the object-URL half of it, so calling an export
 * handler throws rather than failing an assertion.
 */
URL.createObjectURL ??= vi.fn(() => "blob:test");
URL.revokeObjectURL ??= vi.fn();

/**
 * React Testing Library does not auto-clean when `globals` is off, and a left
 * over tree makes the NEXT test's `getByText` match two nodes — a failure that
 * points at the wrong test.
 */
afterEach(() => {
  cleanup();
});
