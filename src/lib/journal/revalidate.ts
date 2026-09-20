import "server-only";
import { revalidatePath } from "next/cache";

/**
 * Which routes to drop from the cache after a write.
 *
 * WHAT THIS REPLACES. Twenty-four call sites reached for
 * `revalidatePath("/", "layout")`, which is the blunt instrument: `"/"` paired
 * with `"layout"` matches the ROOT layout, so it invalidates every route in the
 * application plus the shell itself. Server-side that costs nothing — every
 * page here is dynamic anyway — but it purges the client's Router Cache
 * wholesale. The visible result was that ticking one tracker checkbox made the
 * next visit to the dashboard, the journal and reports each re-run its full
 * query set from scratch. That is the "slow to switch pages" symptom.
 *
 * The intent behind those calls was right: a saved trade really does change
 * nine screens. What was wrong is that it also purged `/settings`, and the
 * layout — which renders the sidebar and nothing else, and cannot be affected
 * by any of this.
 *
 * So the lists below are honest rather than minimal. They are still long. The
 * point is that each entry is there because that route READS the data, and can
 * be checked against the page that does.
 */

/**
 * Routes that read the trade book.
 *
 * All nine call `getTradesWithStats` — verified against their `page.tsx`. If a
 * tenth route starts reading trades it belongs here, and if one stops it should
 * come out.
 */
const TRADE_ROUTES = [
  "/",
  "/journal",
  "/reports",
  "/calendar",
  "/daily",
  "/weekly",
  "/playbooks",
  "/notebook",
  "/import",
] as const;

/**
 * Routes that read the tag categories and the custom field registry.
 *
 * Narrower than the trade set on purpose: changing a dropdown option cannot
 * move a number on the calendar, but it does change what the entry forms offer
 * and what the report dimensions can group by.
 */
const OPTION_ROUTES = [
  "/settings",
  "/trades/new",
  "/journal",
  "/reports",
  "/",
] as const;

/** After anything that creates, edits or deletes trade data. */
export function revalidateTrades() {
  for (const p of TRADE_ROUTES) revalidatePath(p);
}

/** After a change to categories, tags, custom fields or instruments. */
export function revalidateOptions() {
  for (const p of OPTION_ROUTES) revalidatePath(p);
}

/**
 * After a change to the daily check-in or its tracker rules.
 *
 * Deliberately NOT the trade set. A ticked rule moves the day's compliance and
 * the dashboard's streak; it does not touch a single trade, so the journal,
 * reports and the calendar's P&L have no reason to be re-fetched. This is the
 * call site that fired on every checkbox.
 */
export function revalidateDaily() {
  revalidatePath("/daily");
  revalidatePath("/");
  revalidatePath("/calendar");
}

/**
 * After a weekly review is saved or sealed.
 *
 * `/reports` and not only `/weekly`: the week rating is a report dimension
 * (`reports/dimensions.ts`, key `week_grade`), read through `getWeekGrades()`
 * on the reports page. Rating a week and finding the report still grouping it
 * under "no rating" was the bug this exists to prevent.
 */
export function revalidateWeekly() {
  revalidatePath("/weekly");
  revalidatePath("/reports");
}
