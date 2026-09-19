/**
 * Report state read back out of the URL.
 *
 * `/reports` keeps its whole state in query params so a report can be
 * bookmarked and sent to yourself. That makes every one of those params
 * UNTRUSTED INPUT: it survives a reload, a paste, a truncated link and a typo,
 * and TypeScript cannot check a string that arrives at runtime.
 *
 * The workbench used to `as`-cast them straight into typed variables. One of
 * those casts silently disabled a safety mechanism — see `asMinSample` — which
 * is why this parsing lives in its own module with its own tests rather than
 * inline in a component nothing can import.
 *
 * Every function here answers a valid value for ANY input. None of them throw:
 * a bad param should give you the default report, not an error page.
 */

import type { PnlMode } from "../analytics";
import { DEFAULT_MIN_SAMPLE } from "./engine";

/**
 * Money in the account's currency, or as a percentage of equity — the two
 * units a report across many instruments can honestly show. R, points, ticks
 * and pips need one instrument and a per-trade risk, which a report has not
 * got; their buttons only ever sat there disabled. Hiding amounts is a separate
 * switch (`hide=1`), not a unit.
 */
export function asReportView(raw: string | null | undefined): "dollars" | "percentage" {
  return raw === "percentage" ? "percentage" : "dollars";
}

/**
 * P&L basis, defaulting to net.
 *
 * Deliberately "gross only when the param says gross" rather than "net only
 * when it says net". The cast this replaces treated every value that was not
 * exactly `"net"` as gross, so `?basis=Net` — one capital letter — reported
 * gross P&L underneath a toggle still highlighting "Net". Net is what the UI
 * shows by default, so net is the safe direction to fall back to.
 */
export function asPnlBasis(raw: string | null | undefined): PnlMode {
  return raw === "gross" ? "gross" : "net";
}

/** The thresholds the picker offers. */
export const MIN_SAMPLE_OPTIONS = [1, 3, 5, 10, 20] as const;

/**
 * Small-sample threshold.
 *
 * The one that mattered. `Number("abc")` is `NaN`, and `trades.length < NaN` is
 * `false` — so with `?min=abc` **no bucket was ever flagged `belowSample`**, and
 * `summarizeReport`'s eligibility filter passed everything through. That filter
 * is the entire mechanism stopping a three-trade bucket from being crowned
 * "best performing"; the engine's own header calls that "exactly the mistake
 * this whole engine is built to avoid". A typo in a bookmarked URL turned it off
 * with nothing on screen to say so.
 *
 * Snapped DOWN to one of `MIN_SAMPLE_OPTIONS`, so the picker always shows what
 * is in force (`?min=7` left it blank) and a hand-edited number never becomes a
 * stricter filter than the one in the URL. Floored at 1: a threshold of zero
 * admits every bucket, which is indistinguishable from the bug.
 */
export function asMinSample(raw: string | null | undefined): number {
  if (raw == null || raw === "") return DEFAULT_MIN_SAMPLE;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_MIN_SAMPLE;
  let out: number = MIN_SAMPLE_OPTIONS[0];
  for (const o of MIN_SAMPLE_OPTIONS) if (o <= n) out = o;
  return out;
}
