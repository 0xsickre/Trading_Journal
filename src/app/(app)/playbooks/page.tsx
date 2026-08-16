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

/**
 * Playbooks: define them and judge them in the same place.
 *
 * They used to live as a tab in Settings while their numbers lived in
 * `/reports`, which meant every "is this rule worth keeping" question was two
 * screens and a dimension picker away from the place you would act on it. A
 * playbook is a performance object, not a configuration object.
 */
export default async function PlaybooksPage() {
  // Drained once and handed to `getPlaybooks`, which derives the per-rule answer
  // counts from it. `tj_position_rules` is one row per rule per trade — the
  // fastest-growing table in the schema — and reading it twice per render is
  // the mistake `/reports` already had to fix.
  const positionRules = await getPositionRules();

  const [accounts, trades, playbooks, library] = await Promise.all([
    getAccounts(),
    getTradesWithStats(),
    // Retired rules included: a rule taken off the checklist still owns the
    // observations it collected, and a page about evidence must show them.
    getPlaybooks({ includeDeleted: true, positionRules }),
    getRuleLibrary({ includeDeleted: true }),
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
        library={library}
        trades={enriched}
        lookup={lookup}
        currency={currency}
        breakevenRange={breakevenRange}
      />
    </div>
  );
}
