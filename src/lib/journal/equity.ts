import "server-only";
import { createClient } from "@/lib/supabase/server";
import { selectAllPages } from "@/lib/supabase/paginate";
import { buildBalanceTimeline, currentEquity } from "./balance";
import { getAccounts } from "./accounts";
import { getCashEvents } from "./cash-events";
import { equityAtEntryPatch, firstEntryAt } from "./equity-at-entry";
import { accountTimezoneResolver, dayKeyStartUtc, toEpoch, zonedDateKey } from "./time";
import type { PositionStatus } from "./trade-lifecycle";

/**
 * Current equity per account: starting balance + realized P&L + cash flow.
 *
 * Position sizing used to risk a percentage of `starting_balance`, which never
 * moves. After +40%, or after a withdrawal, "risk 1%" was no longer 1% of
 * anything real — and that suggestion is the one number a trader acts on
 * *before* entering. Sizing reads from here instead.
 *
 * Built from the same primitives as the dashboard's equity curve, so the two
 * can never disagree about what the account is worth.
 */
export async function getAccountEquities(): Promise<Record<string, number>> {
  const supabase = await createClient();

  const [accounts, cashEvents, closed] = await Promise.all([
    getAccounts(),
    getCashEvents(),
    selectAllPages((from, to) =>
      supabase
        .from("tj_position_stats")
        .select("account_id, net_pl, closed_at")
        .eq("status", "closed")
        .order("position_id")
        .range(from, to),
    ),
  ]);

  const out: Record<string, number> = {};
  for (const account of accounts) {
    const trades = closed
      .filter((r) => r.account_id === account.id && r.net_pl != null)
      .map((r) => ({ at: r.closed_at ?? "", pnl: Number(r.net_pl) }));

    out[account.id] = currentEquity(
      buildBalanceTimeline(
        account.starting_balance ?? 0,
        trades,
        cashEvents.filter((c) => c.account_id === account.id),
      ),
    );
  }
  return out;
}

/**
 * What one account was worth at the START of each of the given days.
 *
 * The denominator of every risk percentage, read on the write path so it can be
 * frozen onto the trade (`equity-at-entry.ts` decides whether it may be).
 *
 * THE OPENING BALANCE, not the live one, for the reason
 * `tracker/equity-ladder.ts` sets out: a denominator that shrinks with every
 * loss inside the day allows less risk after each one, so the same trade reads
 * as a different percentage depending on the order the day happened in.
 *
 * NULL IS AN ANSWER, and the case it covers is real: one closed trade on an
 * unpriced instrument makes the realized total unknown from that trade onward,
 * and an unknown total cannot produce an honest percentage. `getAccountEquities`
 * above simply drops those rows — correct for a headline figure that is allowed
 * to be approximate, wrong for a number that is about to be written down as a
 * fact. The same refusal exists in the SQL backfill (`20260920160000`) and in
 * `buildEquityLadder`.
 *
 * Batched by design: one read serves an import of two hundred rows, where one
 * call per trade would be two hundred round trips.
 */
export async function getDayOpeningEquities(
  accountId: string | null | undefined,
  dayKeys: readonly string[],
): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  for (const day of dayKeys) out.set(day, null);
  if (!accountId || out.size === 0) return out;

  const supabase = await createClient();
  const [accounts, cashEvents, closed] = await Promise.all([
    getAccounts(),
    getCashEvents(accountId),
    selectAllPages((from, to) =>
      supabase
        .from("tj_position_stats")
        .select("net_pl, closed_at")
        .eq("account_id", accountId)
        .eq("status", "closed")
        .order("position_id")
        .range(from, to),
    ),
  ]);

  const account = accounts.find((a) => a.id === accountId);
  if (!account) return out;

  for (const day of out.keys()) {
    const cutoff = dayKeyStartUtc(day, account.timezone);
    if (cutoff == null) continue;

    let pnl = 0;
    let unknown = false;
    for (const row of closed) {
      if (toEpoch(row.closed_at ?? "") >= cutoff) continue;
      if (row.net_pl == null) {
        unknown = true;
        break;
      }
      pnl += Number(row.net_pl);
    }
    if (unknown) continue;

    let cash = 0;
    for (const c of cashEvents) {
      if (toEpoch(c.occurred_at) < cutoff) cash += c.amount;
    }

    const equity = (account.starting_balance ?? 0) + pnl + cash;
    out.set(day, equity > 0 ? equity : null);
  }

  return out;
}

/**
 * The `equity_at_entry` patch for one save — the whole decision in one call.
 *
 * Shared by the manual write path and the import so the rule cannot be
 * half-applied on one of them. The read is skipped entirely when the answer is
 * already settled (a trade that keeps its denominator, or one that never had
 * an entry), which is why the patch function is consulted twice: once to see
 * whether the equity is even needed, once with it.
 */
export async function getEquityAtEntryPatch(
  accountId: string | null | undefined,
  status: PositionStatus,
  execs: readonly { side: string; executed_at: string }[],
  prev: { equity_at_entry: number | null } | null,
): Promise<{ equity_at_entry?: number | null }> {
  // With no equity to offer, this already answers for the clear-on-restore case
  // and for every save that must stay silent.
  const settled = equityAtEntryPatch(status, prev, null);
  if ("equity_at_entry" in settled || (prev?.equity_at_entry ?? null) != null) {
    return settled;
  }

  const at = firstEntryAt(execs);
  if (at == null) return settled;

  const tz = accountTimezoneResolver(await getAccounts())(accountId);
  const day = zonedDateKey(at, tz);
  if (!day) return settled;

  const equity = (await getDayOpeningEquities(accountId, [day])).get(day) ?? null;
  return equityAtEntryPatch(status, prev, equity);
}
