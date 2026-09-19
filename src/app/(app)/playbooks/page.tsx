import { getAccounts } from "@/lib/journal/accounts";
import { getTradesWithStats } from "@/lib/journal/trades";
import {
  getPlaybooks,
  getPositionRules,
  getRuleLibrary,
} from "@/lib/journal/playbooks";
import { toRealized } from "@/lib/journal/analytics";
import { enrichTrades } from "@/lib/journal/enriched-trade";
import { buildPlaybookLookup } from "@/lib/journal/reports/playbook-dimensions";
import {
  sharedBreakevenRange,
} from "@/lib/journal/breakeven";
import { PlaybooksScreen } from "@/components/journal/playbooks-screen";
import { PageHeader } from "@/components/app/page-header";
import type { RealizedTrade } from "@/lib/journal/analytics";
import { accountTimezoneResolver } from "@/lib/journal/time";
import { stringFieldValue } from "@/lib/journal/field-values";

/**
 * Playbooks: a compact list of every setup, click through to judge one.
 *
 * Used to be a column of expandable cards holding the full rule editor for
 * every playbook at once. Each playbook now has its own page
 * (`/playbooks/[id]`) with Stats, Rules, Trades and Notes tabs — this screen
 * is just the index into that, so it stays a scannable table instead of a
 * long scroll.
 */
export default async function PlaybooksPage() {
  // `tj_position_rules` — one row per rule per trade, the fastest-growing table
  // in the schema — is drained ONCE per render: `getPositionRules` is memoized
  // per request, and `getPlaybooks` and `getRuleLibrary` both count from it.
  // It no longer has to be awaited alone first to get there, which cost the
  // page a round trip.
  const positionRulesPromise = getPositionRules();

  const [accounts, trades, playbooks, library, positionRules] = await Promise.all([
    getAccounts(),
    getTradesWithStats(),
    // Retired rules included: a rule taken off the checklist still owns the
    // observations it collected, and a page about evidence must show them.
    getPlaybooks({ includeDeleted: true, positionRules: positionRulesPromise }),
    getRuleLibrary({ includeDeleted: true }),
    positionRulesPromise,
  ]);

  const primary = accounts.find((a) => a.is_active) ?? accounts[0] ?? null;
  const currency = primary?.currency ?? "USD";

  const tzFor = accountTimezoneResolver(accounts, primary?.timezone);
  const tzOf = (t: RealizedTrade) => tzFor(t.row.account_id);

  // The same band the dashboard and reports classify with, so a win rate here
  // matches the one on every other screen. Mixed bands fall back to exact zero
  // rather than silently adopting one account's tolerance.
  const breakevenRange = sharedBreakevenRange(accounts);

  const enriched = enrichTrades(toRealized(trades), {
    tzOf,
    range: breakevenRange,
  });

  // Missed-trade counts, from the RAW rows before `toRealized` drops them.
  // `toRealized` keeps only closed trades with a net P&L — a missed trade has
  // neither, so it never reaches `enriched` and this has to read `trades`
  // itself.
  const missedByPlaybook: Record<string, number> = {};
  for (const t of trades) {
    if (t.status !== "missed") continue;
    const id = stringFieldValue(t, "playbook_id");
    if (!id) continue;
    missedByPlaybook[id] = (missedByPlaybook[id] ?? 0) + 1;
  }

  // Built from the LIBRARY, not from the linked rules: a rule unlinked from
  // every playbook still names its own history.
  const lookup = buildPlaybookLookup(
    [{ id: "library", name: "library", rules: library }, ...playbooks],
    positionRules,
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Playbooks"
        description="Define a setup and see what it did. Rules are a library — written once, linked into any number of playbooks, keeping one set of statistics."
      />

      <PlaybooksScreen
        playbooks={playbooks}
        trades={enriched}
        lookup={lookup}
        currency={currency}
        breakevenRange={breakevenRange}
        missedByPlaybook={missedByPlaybook}
      />
    </div>
  );
}
