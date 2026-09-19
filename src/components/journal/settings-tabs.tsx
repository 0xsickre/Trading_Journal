"use client";

import { useState, type ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { replaceSettingsSearch, SETTINGS_TABS, type SettingsTab } from "@/lib/journal/settings-tabs";

const LABELS: Record<SettingsTab, string> = {
  categories: "Categories",
  tracker: "Tracker",
  instruments: "Instruments",
  accounts: "Accounts",
  deposits: "Deposits / withdrawals",
};

/** The Settings tabs, with the open one kept in `?tab=`. */
export function SettingsTabs({
  initial,
  panels,
}: {
  initial: SettingsTab;
  panels: Record<SettingsTab, ReactNode>;
}) {
  const [tab, setTab] = useState<SettingsTab>(initial);
  return (
    <Tabs
      value={tab}
      onValueChange={(v) => {
        setTab(v as SettingsTab);
        replaceSettingsSearch({ tab: v as SettingsTab });
      }}
    >
      {/* The labels are wider than a phone screen, and the triggers are
          whitespace-nowrap — scroll the strip instead of overflowing the page. */}
      <TabsList className="flex w-full max-w-full justify-start overflow-x-auto sm:w-fit">
        {SETTINGS_TABS.map((t) => (
          <TabsTrigger key={t} value={t} className="flex-none">
            {LABELS[t]}
          </TabsTrigger>
        ))}
      </TabsList>
      {SETTINGS_TABS.map((t) => (
        <TabsContent key={t} value={t} className="space-y-4">
          {panels[t]}
        </TabsContent>
      ))}
    </Tabs>
  );
}
