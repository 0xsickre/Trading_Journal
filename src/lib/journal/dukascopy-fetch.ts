import "server-only";
import https from "node:https";
// Kept out of the bundle in `next.config.ts` (`serverExternalPackages`): its
// entry point resolves its own code at run time, which a bundler cannot follow.
import { decompress } from "lzma";
import {
  minuteCandleUrl,
  parseMinuteCandles,
  utcDayStart,
  type FeedCandle,
} from "./dukascopy";

const DAY_MS = 86_400_000;

/**
 * A trade held longer than this is not filled automatically. Not a technical
 * limit — a swing trade here is days, not months — but a bound on how much one
 * save can make the server fetch.
 */
const MAX_DAYS = 45;

/**
 * One day file, raw. `null` for a day Dukascopy has no file for (a weekend, a
 * holiday), which is an absence, not an error.
 *
 * Node's `https` with `family: 4` rather than `fetch`: the datafeed host
 * advertises an IPv6 address that does not answer, and undici's `fetch` sat on
 * it until its connect timeout while IPv4 answered in 40 ms.
 */
function getFile(url: string, timeoutMs = 20_000): Promise<Uint8Array | null> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      // `agent: false` — a fresh connection per request. The feed sits behind a
      // balancer that answers "503 No server is available" from some backends
      // and 200 from others; Node's default agent keeps the connection alive,
      // so every retry went back to the same dead backend and failed again.
      { family: 4, agent: false, headers: { "User-Agent": "Mozilla/5.0" }, timeout: timeoutMs },
      (res) => {
        if (res.statusCode === 404) {
          res.resume();
          resolve(null);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`Dukascopy answered HTTP ${res.statusCode}`));
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("Dukascopy did not answer in time")));
    req.on("error", reject);
  });
}

/**
 * LZMA-JS answers with a string when the decoded bytes happen to be valid UTF-8
 * (see `src/types/lzma.d.ts`). Re-encoding that string as UTF-8 gives the same
 * bytes back.
 */
function inflate(raw: Uint8Array): Uint8Array {
  const out = decompress(raw);
  return typeof out === "string"
    ? new Uint8Array(Buffer.from(out, "utf8"))
    : Uint8Array.from(out, (b) => b & 255);
}

/**
 * Retry with a doubling wait. The feed answers 503 intermittently — "No server
 * is available to handle this request", from some backends of its balancer —
 * and the same file asked again on a new connection comes back 200.
 */
async function withRetry<T>(fn: () => Promise<T>, tries = 6): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 750 * 2 ** i));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

/**
 * 1-minute candles covering [fromMs, toMs], one day file at a time.
 *
 * `cache` is shared across the trades of one call, so ten trades in the same
 * week fetch that week once.
 */
export async function fetchMinuteCandles(
  code: string,
  scale: number,
  fromMs: number,
  toMs: number,
  cache: Map<string, FeedCandle[]> = new Map(),
): Promise<FeedCandle[]> {
  const first = utcDayStart(fromMs);
  const last = utcDayStart(toMs);
  if ((last - first) / DAY_MS > MAX_DAYS) {
    throw new Error(`held longer than ${MAX_DAYS} days — not filled automatically`);
  }
  const days: number[] = [];
  for (let d = first; d <= last; d += DAY_MS) days.push(d);

  const out: FeedCandle[] = [];
  // Two at a time: a week in a few seconds, and polite to a free public feed.
  for (let i = 0; i < days.length; i += 2) {
    const batch = await Promise.all(
      days.slice(i, i + 2).map(async (day) => {
        const url = minuteCandleUrl(code, day);
        const hit = cache.get(url);
        if (hit) return hit;
        const raw = await withRetry(() => getFile(url));
        const candles =
          raw && raw.byteLength > 0 ? parseMinuteCandles(inflate(raw), day, scale) : [];
        cache.set(url, candles);
        return candles;
      }),
    );
    for (const c of batch) out.push(...c);
  }
  return out;
}
