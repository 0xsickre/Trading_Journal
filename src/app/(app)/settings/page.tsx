import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getListsWithItems } from "@/lib/journal/options";
import { getInstruments } from "@/lib/journal/instruments";
import { getAccounts } from "@/lib/journal/accounts";
import { getCashEvents } from "@/lib/journal/cash-events";
import { ListManager } from "@/components/journal/list-manager";
import { InstrumentManager } from "@/components/journal/instrument-manager";
import { AccountSettings } from "@/components/journal/account-settings";
import { DangerZone } from "@/components/journal/danger-zone";
import { getAccountUsage } from "@/lib/journal/account-usage-queries";
import { CashEventsManager } from "@/components/journal/cash-events-manager";
import { NewListForm } from "@/components/journal/new-list-form";
import { FieldDefManager } from "@/components/journal/field-def-manager";
import { getFieldDefs } from "@/lib/journal/field-defs";
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
    fieldDefs,
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
      // Archived defs included — this screen is where you un-archive them.
      getFieldDefs(false),
      // Retired rules included, for the same reason.
      getTrackerRules({ includeRetired: true }),
      getBotTokens(),
      getBrokerSymbolMaps(),
      getQuarantinedEvents(),
      countQuarantinedEvents(),
    ]);

  // Same choice as getPrimaryAccount, made from the list already in hand rather
  // than with a second round trip. Only the currency label needs it.
  const primaryAccount = accounts.find((a) => a.is_active) ?? accounts[0] ?? null;

  // Counted here rather than when the delete dialog opens: the confirmation has
  // to state what it is about to destroy at the moment it is read, and a dialog
  // that fetches on open shows an empty list first and the truth a beat later.
  const accountUsage = await getAccountUsage(accounts.map((a) => a.id));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Manage your dropdown lists, instruments and accounts. Archiving an option hides it from entry forms but keeps it filterable in history."
      />

      <Tabs defaultValue="lists">
        {/* The labels are wider than a phone screen, and the triggers are
            whitespace-nowrap — scroll the strip instead of overflowing the page. */}
        <TabsList className="flex w-full max-w-full justify-start overflow-x-auto sm:w-fit">
          <TabsTrigger value="lists" className="flex-none">
            Dropdown Lists
          </TabsTrigger>
          <TabsTrigger value="fields" className="flex-none">
            My fields
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
          <div className="flex justify-end">
            <NewListForm />
          </div>
          <ListManager lists={lists} />
        </TabsContent>

        <TabsContent value="fields">
          <FieldDefManager defs={fieldDefs} lists={lists} />
        </TabsContent>

        <TabsContent value="tracker">
          <TrackerRuleManager
            rules={trackerRules}
            currency={primaryAccount?.currency ?? "USD"}
          />
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
