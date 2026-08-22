import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getListsWithItems } from "@/lib/journal/options";
import { getAllOptionUsage } from "@/lib/journal/option-usage-queries";
import { getInstruments } from "@/lib/journal/instruments";
import { getAccounts } from "@/lib/journal/accounts";
import { getCashEvents } from "@/lib/journal/cash-events";
import { ListManager } from "@/components/journal/list-manager";
import { InstrumentManager } from "@/components/journal/instrument-manager";
import { AccountSettings } from "@/components/journal/account-settings";
import { DangerZone } from "@/components/journal/danger-zone";
import { getAccountUsage } from "@/lib/journal/account-usage-queries";
import { CashEventsManager } from "@/components/journal/cash-events-manager";
import { TrackerRuleManager } from "@/components/journal/tracker-rule-manager";
import { getTrackerRules } from "@/lib/journal/tracker/queries";
import { PageHeader } from "@/components/app/page-header";
import { BotBridgeManager } from "@/components/journal/bot-bridge-manager";
import {
  countQuarantinedEvents,
  getBotTokens,
  getBrokerSymbolMaps,
  getQuarantinedEvents,
} from "@/lib/journal/bot-queries";

export default async function SettingsPage() {
  const [
    lists,
    instruments,
    accounts,
    cashEvents,
    trackerRules,
    botTokens,
    symbolMaps,
    quarantined,
    quarantineTotal,
  ] = await Promise.all([
      getListsWithItems(false),
      getInstruments(false),
      getAccounts(),
      getCashEvents(),
      // Retired rules included, for the same reason.
      getTrackerRules({ includeRetired: true }),
      getBotTokens(),
      getBrokerSymbolMaps(),
      getQuarantinedEvents(),
      countQuarantinedEvents(),
    ]);

  // Counted here rather than when the delete dialog opens: the confirmation has
  // to state what it is about to destroy at the moment it is read, and a dialog
  // that fetches on open shows an empty list first and the truth a beat later.
  const accountUsage = await getAccountUsage(accounts.map((a) => a.id));

  // The Tags table shows a "Used" count on every row, so it has to be there
  // when the table first paints — one batched read rather than a head count per
  // tag. The delete dialogs re-count head-on before they act; see
  // `getAllOptionUsage` for why the two differ.
  const optionUsage = await getAllOptionUsage(lists.map((l) => l.key));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Manage your categories, instruments and accounts. Deleting a category or option is safe — trades that used it keep the text. Archiving hides an option from entry forms without deleting it."
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
          <TabsTrigger value="bot" className="flex-none">
            Bot most
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
            Katalog stiže popunjen i sve što je u njemu odmah stoji u formi za
            unos trejda — ovde se ne „pali" ništa. Sekcija postoji zbog dve
            stvari koje katalog ne može da pogodi: simbola kojeg nema, i
            specifikacije koja se kod tvog brokera razlikuje.
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
          <AccountSettings accounts={accounts} usage={accountUsage} />
          {/* On the Accounts tab, not a seventh one: this is where someone
              already is when they discover they cannot remove what they made. */}
          <DangerZone />
        </TabsContent>

        <TabsContent value="cash">
          <CashEventsManager accounts={accounts} events={cashEvents} />
        </TabsContent>

        <TabsContent value="bot">
          {/*
            Instruments are passed as bare symbols: the mapping question is
            "which instrument does this broker symbol mean", and the answer is
            the symbol itself — the rest of the catalogue row is not part of it.
          */}
          <BotBridgeManager
            accounts={accounts}
            tokens={botTokens}
            symbolMaps={symbolMaps}
            quarantined={quarantined}
            quarantineTotal={quarantineTotal}
            instruments={instruments.map((i) => i.symbol)}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
