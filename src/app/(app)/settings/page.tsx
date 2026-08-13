import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getListsWithItems } from "@/lib/journal/options";
import { getInstruments } from "@/lib/journal/instruments";
import { getAccounts } from "@/lib/journal/accounts";
import { getCashEvents } from "@/lib/journal/cash-events";
import { ListManager } from "@/components/journal/list-manager";
import { InstrumentManager } from "@/components/journal/instrument-manager";
import { AccountSettings } from "@/components/journal/account-settings";
import { CashEventsManager } from "@/components/journal/cash-events-manager";
import { NewListForm } from "@/components/journal/new-list-form";
import { FieldDefManager } from "@/components/journal/field-def-manager";
import { getFieldDefs } from "@/lib/journal/field-defs";
import { PlaybookManager } from "@/components/journal/playbook-manager";
import { getPlaybooks, getRuleLibrary } from "@/lib/journal/playbooks";
import { TrackerRuleManager } from "@/components/journal/tracker-rule-manager";
import { getTrackerRules } from "@/lib/journal/tracker/queries";
import { PageHeader } from "@/components/app/page-header";

export default async function SettingsPage() {
  const [
    lists,
    instruments,
    accounts,
    cashEvents,
    fieldDefs,
    playbooks,
    ruleLibrary,
    trackerRules,
  ] = await Promise.all([
      getListsWithItems(false),
      getInstruments(false),
      getAccounts(),
      getCashEvents(),
      // Archived defs included — this screen is where you un-archive them.
      getFieldDefs(false),
      // Retired rules included, for the same reason.
      getPlaybooks({ includeDeleted: true }),
      // The whole library, not only the linked rules: the manager offers an
      // existing rule for re-linking, which is what stops a second playbook
      // retyping it into a new id with empty statistics.
      getRuleLibrary({ includeDeleted: true }),
      getTrackerRules({ includeRetired: true }),
    ]);

  // Same choice as getPrimaryAccount, made from the list already in hand rather
  // than with a second round trip. Only the currency label needs it.
  const primaryAccount = accounts.find((a) => a.is_active) ?? accounts[0] ?? null;

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
          <TabsTrigger value="playbooks" className="flex-none">
            Playbook
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
        </TabsList>

        <TabsContent value="lists" className="space-y-4">
          <div className="flex justify-end">
            <NewListForm />
          </div>
          <ListManager lists={lists} />
        </TabsContent>

        <TabsContent value="playbooks">
          <PlaybookManager playbooks={playbooks} library={ruleLibrary} />
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
          <InstrumentManager instruments={instruments} />
        </TabsContent>

        <TabsContent value="accounts">
          <AccountSettings accounts={accounts} />
        </TabsContent>

        <TabsContent value="cash">
          <CashEventsManager accounts={accounts} events={cashEvents} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
