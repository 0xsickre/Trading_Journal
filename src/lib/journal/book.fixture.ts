import type { RealizedTrade } from "./analytics";
import { mkTrade } from "./reports/test-helpers";

/**
 * THE BOOK, shared between the `lib/` proof and the render proof.
 *
 * `book.fixture.test.ts` derives every headline figure from this book ON PAPER
 * and asserts the pure functions agree. `dashboard.render.test.tsx` renders the
 * actual `<Dashboard>` with the SAME book and asserts the SAME figures appear on
 * screen. One fixture, two layers, so a number that is right in the library and
 * wrong on screen — which is exactly how `S1` shipped — has nowhere to hide.
 *
 * Kept as a `.ts` file rather than living only in the `.test.ts` so a `.tsx`
 * render test can import it without dragging a second copy into existence.
 */

export const TZ = "America/New_York";

/**
 * Ten closed trades, 2–13 March 2026.
 *
 * Net P&L is chosen so every aggregate lands on a number that can be checked
 * without a calculator, and so profit factor and recovery factor come to rest
 * exactly on a scoring-band floor — the place an off-by-one in the band table
 * would show.
 *
 *   #   closed (NY)   net     cumulative   running peak   drop
 *   1   Mon 03-02    +300         300          300          0
 *   2   Tue 03-03    -100         200          300       -100
 *   3   Wed 03-04    +200         400          400          0
 *   4   Thu 03-05     -50         350          400        -50
 *   5   Fri 03-06    +150         500          500          0
 *   6   Mon 03-09    -200         300          500       -200  ← worst
 *   7   Tue 03-10    +400         700          700          0
 *   8   Wed 03-11    -150         550          700       -150
 *   9   Thu 03-12       0         550          700       -150   breakeven
 *  10   Fri 03-13     +50         600          700       -100
 *
 * Trade 7 is opened on Monday the 9th and closed on Tuesday the 10th: its money
 * belongs to the 10th and the decision to take it belongs to the 9th. Every
 * other trade opens and closes the same day.
 *
 * See `book.fixture.test.ts` for every figure this book derives to, worked on
 * paper.
 */
export const BOOK_NET = [300, -100, 200, -50, 150, -200, 400, -150, 0, 50];
export const CLOSE_DAYS = [
  "2026-03-02",
  "2026-03-03",
  "2026-03-04",
  "2026-03-05",
  "2026-03-06",
  "2026-03-09",
  "2026-03-10",
  "2026-03-11",
  "2026-03-12",
  "2026-03-13",
];

export const BOOK: RealizedTrade[] = BOOK_NET.map((net, i) =>
  mkTrade({
    id: `b${i + 1}`,
    net,
    // 18:00Z is 13:00 EST before 8 March and 14:00 EDT after it — the same
    // calendar day in New York either way, so the DST change inside this window
    // cannot silently move a trade between days.
    closedAt: `${CLOSE_DAYS[i]}T18:00:00Z`,
    openedAt: i === 6 ? "2026-03-09T18:00:00Z" : `${CLOSE_DAYS[i]}T14:00:00Z`,
  }),
);

/**
 * A book of `nets.length` trades closing on successive days of April 2026, for
 * exercising the SHAPES a book can take (empty, one trade, all winners, …)
 * rather than this specific book's values.
 */
export function shapedBook(nets: number[]): RealizedTrade[] {
  return nets.map((net, i) =>
    mkTrade({
      id: `s${i}`,
      net,
      r: net / 100,
      closedAt: `2026-04-${String(i + 1).padStart(2, "0")}T18:00:00Z`,
    }),
  );
}
