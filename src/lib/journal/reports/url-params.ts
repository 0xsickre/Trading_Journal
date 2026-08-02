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
import { VIEW_MODES, type ViewMode } from "../units";
import { DEFAULT_MIN_SAMPLE } from "./engine";

const VIEW_MODE_SET = new Set<string>(VIEW_MODES.map((m) => m.value));

/** A `view` outside the seven known modes falls back to dollars. */
export function asViewMode(raw: string | null | undefined): ViewMode {
  return raw && VIEW_MODE_SET.has(raw) ? (raw as ViewMode) : "dollars";
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

export function asChartType(raw: string | null | undefined): "bar" | "line" {
  return raw === "line" ? "line" : "bar";
}

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
 * Floored at 1, not 0: a threshold of zero admits every bucket, which is
 * indistinguishable from the bug. Truncated rather than rounded so `?min=2.9`
 * cannot quietly become a stricter filter than the number in the URL.
 */
export function asMinSample(raw: string | null | undefined): number {
  if (raw == null || raw === "") return DEFAULT_MIN_SAMPLE;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(1, Math.floor(n)) : DEFAULT_MIN_SAMPLE;
}
