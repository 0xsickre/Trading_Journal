import "server-only";

import { autoMistakes, type AutoMistake } from "./auto-mistakes";
import { getAccounts, getPrimaryAccount } from "./accounts";
import { breakevenRangeResolver } from "./breakeven";
import { firstBiasResolver } from "./daily-bias";
import { getDailyBiases } from "./daily-bias-queries";
import { flatByResolver } from "./flat-by";
import { accountDayZoneResolver, dayKeyIn } from "./time";
import { getTradesWithStats } from "./trades";
import { getTrackerRules } from "./tracker/queries";
import { tradingWindowResolver } from "./tracker/trading-window";
import type { TradeRow } from "./types";

/**
 * The automatic mistakes (phase B4) of the trades opened on the days `from`–`to`,
 * by trade id — read from the same rows the tracker grades: every trade of those
 * days (a run of stops needs the day's other trades), the trading
 * window and the bias cards of the same span.
 */
export async function getAutoMistakes(from: string, to: string): Promise<Map<string, AutoMistake[]>> {
  const [accounts, primary, rules, all, biases] = await Promise.all([
    getAccounts(),
    getPrimaryAccount(),
    getTrackerRules({ includeRetired: true }),
    getTradesWithStats(),
    getDailyBiases(from, to),
  ]);
  const zoneOf = accountDayZoneResolver(accounts, primary);
  const tzOf = (row: TradeRow) => zoneOf(row.account_id);
  const inSpan = (iso: string | null | undefined) => {
    const d = iso ? dayKeyIn(iso, zoneOf(null)) : "";
    return d !== "" && d >= from && d <= to;
  };
  const rows = all.filter((r) => inSpan(r.stats?.opened_at) || inSpan(r.stats?.closed_at));
  return autoMistakes(rows, tzOf, breakevenRangeResolver(accounts), {
    tradingWindowOf: tradingWindowResolver(rules),
    biasOf: firstBiasResolver(biases),
    flatByOf: flatByResolver(accounts),
  });
}
