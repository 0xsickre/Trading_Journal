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
import { getUserPrefs } from "@/lib/journal/user-prefs";
import { getOptionsMap } from "@/lib/journal/options";
import { stringFieldValue } from "@/lib/journal/field-values";

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

  const [accounts, trades, playbooks, library, prefs, optionsMap] = await Promise.all([
    getAccounts(),
    getTradesWithStats(),
    // Retired rules included: a rule taken off the checklist still owns the
    // observations it collected, and a page about evidence must show them.
    getPlaybooks({ includeDeleted: true, positionRules }),
    getRuleLibrary({ includeDeleted: true }),
    getUserPrefs(),
    // Playbook sections come from `rule_category`, an ordinary option list —
    // added, renamed, reordered and deleted on the playbook card itself. They
    // used to be five values fixed in code, and the list now starts empty.
    //
    // `activeOnly = false`, unlike every other reader of this map. A section is
    // deleted, not archived (see 20260822160000): switching one off would hide
    // the heading from this card while its rules kept rendering under a label
    // the list no longer supplied, and an archived EMPTY section would vanish
    // with no way left to delete it. This page is where sections are managed,
    // so it has to see all of them.
    getOptionsMap(false),
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
  // itself. A plain `Record`, not a `Map`: this crosses the server/client
  // boundary as a prop, and every other cross-boundary lookup here (like
  // `OptionsMap`) is already a `Record` rather than something the RSC
  // serializer has to be trusted with.
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
        library={library}
        trades={enriched}
        lookup={lookup}
        currency={currency}
        breakevenRange={breakevenRange}
        initialExpanded={prefs.playbooksExpanded}
        categories={optionsMap.rule_category ?? []}
        missedByPlaybook={missedByPlaybook}
      />
    </div>
  );
}
