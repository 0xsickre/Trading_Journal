import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getListsWithItems } from "@/lib/journal/options";
import { getAllOptionUsage } from "@/lib/journal/option-usage-queries";
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

export default async function SettingsPage() {
  // The Tags table shows a "Used" count on every row, so it has to be there
  // when the table first paints — one batched read rather than a head count per
  // tag. The delete dialogs re-count head-on before they act; see
  // `getAllOptionUsage` for why the two differ. It needs the list keys, so it is
  // chained onto the lists inside the one batch rather than run after it.
  const listsPromise = getListsWithItems(false);
  const accountsPromise = getAccounts();
  const [lists, instruments, accounts, cashEvents, trackerRules, optionUsage, tradeCounts] =
    await Promise.all([
      listsPromise,
      getInstruments(false),
      accountsPromise,
      getCashEvents(),
      // Retired rules included, for the same reason.
      getTrackerRules({ includeRetired: true }),
      listsPromise.then((l) => getAllOptionUsage(l.map((x) => x.key))),
      // One head count per account, for the Trades column of the list.
      accountsPromise.then((a) => getAccountTradeCounts(a.map((x) => x.id))),
    ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Manage your tag categories, instruments and accounts. Deleting a category or a tag is safe — trades that used it keep the text. Archiving hides a tag from entry forms without deleting it."
      />

      <Tabs defaultValue="lists">
        {/* The labels are wider than a phone screen, and the triggers are
            whitespace-nowrap — scroll the strip instead of overflowing the page. */}
        <TabsList className="flex w-full max-w-full justify-start overflow-x-auto sm:w-fit">
          <TabsTrigger value="lists" className="flex-none">
            Categories
          </TabsTrigger>
          <TabsTrigger value="tracker" className="flex-none">
            Tracker
          </TabsTrigger>
          <TabsTrigger value="instruments" className="flex-none">
            Instruments
          </TabsTrigger>
          <TabsTrigger value="accounts" className="flex-none">
            Accounts
          </TabsTrigger>
          <TabsTrigger value="cash" className="flex-none">
            Deposits / withdrawals
          </TabsTrigger>
        </TabsList>

        <TabsContent value="lists" className="space-y-4">
          <ListManager lists={lists} usage={optionUsage} />
        </TabsContent>

        <TabsContent value="tracker">
          <TrackerRuleManager rules={trackerRules} />
        </TabsContent>

        <TabsContent value="instruments">
          {/*
            The catalog arrives populated and everything in it is immediately
            available in the trade form — nothing is "switched on" here. This
            section exists for the two things the catalog cannot guess: a symbol
            it does not carry, and a contract spec your broker defines
            differently.
          */}
          <p className="mb-4 text-sm text-muted-foreground">
            Katalog od 91 instrumenta je već aktivan i vidljiv pri unosu trejda.
            Ovde se dodaje simbol kojeg nema, ili ispravlja{" "}
            <span className="font-medium">$ / point</span> i{" "}
            <span className="font-medium">tick</span> kad se tvoj broker
            razlikuje od podrazumevane specifikacije — kod CFD-ova se razlikuje
            često, kod futures ugovora nikad, jer ih objavljuje berza.
          </p>
          <InstrumentManager instruments={instruments} />
        </TabsContent>

        <TabsContent value="accounts" className="space-y-6">
          <AccountSettings accounts={accounts} tradeCounts={tradeCounts} />
          {/* On the Accounts tab, not a seventh one: this is where someone
              already is when they discover they cannot remove what they made. */}
          <DangerZone />
        </TabsContent>

        <TabsContent value="cash">
          <CashEventsManager accounts={accounts} events={cashEvents} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
