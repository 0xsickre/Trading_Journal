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

export default async function SettingsPage() {
  const [lists, instruments, accounts, cashEvents] = await Promise.all([
    getListsWithItems(false),
    getInstruments(false),
    getAccounts(),
    getCashEvents(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-muted-foreground">
          Manage your dropdown lists, instruments and accounts. Archiving an
          option hides it from entry forms but keeps it filterable in history.
        </p>
      </div>

      <Tabs defaultValue="lists">
        <TabsList>
          <TabsTrigger value="lists">Dropdown Lists</TabsTrigger>
          <TabsTrigger value="instruments">Instruments</TabsTrigger>
          <TabsTrigger value="accounts">Accounts</TabsTrigger>
          <TabsTrigger value="cash">Uplate / isplate</TabsTrigger>
        </TabsList>

        <TabsContent value="lists" className="space-y-4">
          <div className="flex justify-end">
            <NewListForm />
          </div>
          <ListManager lists={lists} />
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
