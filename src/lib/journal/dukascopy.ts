/**
 * Dukascopy's public historical datafeed — the source of MAE/MFE for BACKTEST
 * accounts.
 *
 * Chosen by measurement, not by reputation (FAZA_8B_PLAN.md). Of every source
 * this project has keys or access for, it was the only one that returned
 * 1-minute history for all three traded instruments back to 2018, where
 * TradingView replays live:
 *
 *   FMP            HTTP 402 on both keys — 1-minute history is a paid plan
 *   Twelve Data    free tier: recent gold only; NDX and copper need a paid plan
 *   Yahoo          1-minute for 7 days, 1-hour for 730; futures, not CFDs
 *   Dukascopy      ticks and 1-minute candles, XAUUSD / NAS100 / copper, 2018+
 *
 * Free, no key, for personal research use — which is what this is. Not
 * redistributed: the candles are read, reduced to two prices, and dropped.
 *
 * ONE FILE PER DAY. `BID_candles_min_1.bi5` holds that UTC day's 1440 minute
 * candles, LZMA-compressed, ~15 KB. A week-long swing trade is seven small files
 * — the hourly tick files would be a hundred and sixty-eight large ones.
 */

/**
 * Journal symbol → Dukascopy instrument, and the integer scale it stores prices
 * at. Only instruments whose scale was checked against known prices are here;
 * anything else is refused rather than read at a guessed scale, which would
 * produce an extreme a thousand times off and look like data.
 */
export const DUKASCOPY_INSTRUMENTS: Record<
  string,
  {
    code: string;
    scale: number;
    /**
     * The largest price difference between this feed and a broker that is
     * still a difference between brokers. Beyond it the fills are not a
     * different quote of the same moment — they are a different moment, and the
     * trade's times are wrong. Measured, not assumed: gold matched OANDA to the
     * cent on three trades, copper sat 2.5 cents apart.
     */
    maxBasis: number;
  }
> = {
  // 7 Mar 2018 08h UTC: raw 1331242 → 1331.242, where gold traded.
  XAUUSD: { code: "XAUUSD", scale: 1000, maxBasis: 1 },
  // 20 Sep 2023 14h UTC: raw 15220169 → 15220.169.
  NAS100: { code: "USATECHIDXUSD", scale: 1000, maxBasis: 10 },
  // 20 Sep 2023 14h UTC: raw 37590 → 3.7590 USD/lb. Dukascopy's copper runs a
  // few cents above OANDA's; the basis is measured per trade, see
  // `excursion-feed.ts`.
  XCUUSD: { code: "COPPERCMDUSD", scale: 10000, maxBasis: 0.06 },
  HG: { code: "COPPERCMDUSD", scale: 10000, maxBasis: 0.06 },
};

export type FeedCandle = {
  /** Candle open, epoch ms (UTC). */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
};

const DAY_MS = 86_400_000;

/** The UTC midnight a timestamp falls on. */
export function utcDayStart(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

/**
 * The file holding one UTC day's 1-minute candles.
 *
 * Dukascopy's month is ZERO-based in the path — March is `02` — which is the
 * kind of detail that silently fetches the wrong month and returns real-looking
 * prices for it.
 */
export function minuteCandleUrl(code: string, dayStartMs: number): string {
  const d = new Date(dayStartMs);
  const mm = String(d.getUTCMonth()).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `https://datafeed.dukascopy.com/datafeed/${code}/${d.getUTCFullYear()}/${mm}/${dd}/BID_candles_min_1.bi5`;
}

/**
 * Decoded day file → candles.
 *
 * 24-byte big-endian records: seconds from UTC midnight (u32), open, close,
 * low, high (u32, price × scale), volume (f32). A minute with zero volume is a
 * carried-over price, not an observation, and is left out: an extreme the
 * market never printed is not an extreme.
 */
export function parseMinuteCandles(
  bytes: Uint8Array,
  dayStartMs: number,
  scale: number,
): FeedCandle[] {
  const out: FeedCandle[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i + 24 <= bytes.byteLength; i += 24) {
    const volume = view.getFloat32(i + 20);
    if (!(volume > 0)) continue;
    out.push({
      t: dayStartMs + view.getUint32(i) * 1000,
      o: view.getUint32(i + 4) / scale,
      c: view.getUint32(i + 8) / scale,
      l: view.getUint32(i + 12) / scale,
      h: view.getUint32(i + 16) / scale,
    });
  }
  return out;
}
