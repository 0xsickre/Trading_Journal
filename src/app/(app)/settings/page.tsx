import { SettingsTabs } from "@/components/journal/settings-tabs";
import { parseCategorySubtab, parseSettingsTab } from "@/lib/journal/settings-tabs";
import { getListsWithItems } from "@/lib/journal/options";
import { getInstruments } from "@/lib/journal/instruments";
import { getAccounts } from "@/lib/journal/accounts";
import { getAccountTradeCounts } from "@/lib/journal/account-usage-queries";
import { getCashEvents } from "@/lib/journal/cash-events";
import { ListManager } from "@/components/journal/list-manager";
import { InstrumentManager } from "@/components/journal/instrument-manager";
import { AccountSettings } from "@/components/journal/account-settings";
import { DangerZone } from "@/components/journal/danger-zone";
import { CashEventsManager } from "@/components/journal/cash-events-manager";
import { TrackerRuleManager } from "@/components/journal/tracker-rule-manager";
import { getTrackerRules } from "@/lib/journal/tracker/queries";
import { PageHeader } from "@/components/app/page-header";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[]; sub?: string | string[] }>;
}) {
  const params = await searchParams;
  const tab = parseSettingsTab(params.tab);
  const sub = parseCategorySubtab(params.sub);
  // The "Used" count on each tag is NOT read here. It scans the tag columns of
  // every trade, and only the Tags table shows it, so `ListManager` asks for it
  // when that table is first opened (`getTagUsage`) — the other four tabs no
  // longer wait for a tally they never show.
  const accountsPromise = getAccounts();
  const [lists, instruments, accounts, cashEvents, trackerRules, tradeCounts] =
    await Promise.all([
      getListsWithItems(false),
      getInstruments(false),
      accountsPromise,
      getCashEvents(),
      // Retired rules included, so they can be restored.
      getTrackerRules({ includeRetired: true }),
      // One head count per account, for the Trades column of the list.
      accountsPromise.then((a) => getAccountTradeCounts(a.map((x) => x.id))),
    ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Categories and tags, daily rules, instruments, accounts and deposits."
      />

      <SettingsTabs
        initial={tab}
        panels={{
          categories: <ListManager lists={lists} initialSub={sub} />,
          tracker: <TrackerRuleManager rules={trackerRules} />,
          instruments: <InstrumentManager instruments={instruments} />,
          accounts: (
            <>
              <AccountSettings accounts={accounts} tradeCounts={tradeCounts} />
              {/* On the Accounts tab, not a tab of its own: this is where someone
                  already is when they discover they cannot remove what they made. */}
              <DangerZone />
            </>
          ),
          deposits: <CashEventsManager accounts={accounts} events={cashEvents} />,
        }}
      />
    </div>
  );
}
