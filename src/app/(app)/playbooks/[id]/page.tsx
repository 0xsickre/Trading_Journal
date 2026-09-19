import { primaryAccount } from "@/lib/journal/account-rules";
import { notFound } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getAccounts } from "@/lib/journal/accounts";
import { getTradesWithStats } from "@/lib/journal/trades";
import { getFieldDefs } from "@/lib/journal/field-defs";
import { getOptionsMap } from "@/lib/journal/options";
import {
  getPlaybooks,
  getPositionRules,
  getRuleLibrary,
  type Playbook,
  type PositionRule,
} from "@/lib/journal/playbooks";
import { getNotesForPlaybook } from "@/lib/journal/notes/queries";
import { toRealized } from "@/lib/journal/analytics";
import { enrichTrades } from "@/lib/journal/enriched-trade";
import { buildPlaybookLookup } from "@/lib/journal/reports/playbook-dimensions";
import { sharedBreakevenRange } from "@/lib/journal/breakeven";
import { accountTimezoneResolver, DEFAULT_TZ } from "@/lib/journal/time";
import { todayInTz } from "@/lib/journal/daily-report";
import { stringFieldValue } from "@/lib/journal/field-values";
import { sharedCurrency } from "@/lib/journal/format";
import type { RealizedTrade } from "@/lib/journal/analytics";
import type { TradeRow } from "@/lib/journal/types";
import { JournalGrid } from "@/components/journal/journal-grid";
import { PlaybookIdentityHeader } from "@/components/journal/playbook-identity-header";
import { PlaybookStatsTab } from "@/components/journal/playbook-stats-tab";
import { PlaybookRulesEditor } from "@/components/journal/playbook-rules-editor";
import { PlaybookNotesPanel } from "@/components/journal/playbook-notes-panel";

/**
 * One playbook: what it is, what it did, its checklist, its trades, and notes
 * about it. Replaces the expandable card that used to hold all of this at
 * once on `/playbooks` — every trader's setup now gets its own page instead of
 * sharing one long scroll with every other setup.
 */
export default async function PlaybookDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Drained once per render, as on `/playbooks`: `getPositionRules` is memoized
  // per request and `getPlaybooks`/`getRuleLibrary` count from it. Started with
  // everything else instead of awaited alone first, which cost a round trip.
  const positionRulesPromise = getPositionRules();

  const [accounts, trades, playbooks, library, optionsMap, fieldDefs, notes, positionRules] =
    await Promise.all([
      getAccounts(),
      getTradesWithStats(),
      getPlaybooks({ includeDeleted: true, positionRules: positionRulesPromise }),
      getRuleLibrary({ includeDeleted: true }),
      getOptionsMap(false),
      getFieldDefs(false),
      getNotesForPlaybook(id),
      positionRulesPromise,
    ]);

  const book = playbooks.find((b) => b.id === id);
  if (!book) notFound();

  const primary = primaryAccount(accounts);
  // Null when the accounts' currencies differ — see the list page.
  const currency = sharedCurrency(accounts);
  const todayKey = todayInTz(primary?.timezone ?? DEFAULT_TZ);

  const tzFor = accountTimezoneResolver(accounts, primary?.timezone);
  const tzOf = (t: RealizedTrade) => tzFor(t.row.account_id);
  const breakevenRange = sharedBreakevenRange(accounts);

  const bookTrades = trades.filter(
    (t) => stringFieldValue(t, "playbook_id") === book.id,
  ) as TradeRow[];
  const enrichedBookTrades = enrichTrades(toRealized(bookTrades), {
    tzOf,
    range: breakevenRange,
  });
  const missedCount = bookTrades.filter((t) => t.status === "missed").length;

  // Only the answers this book's own trades recorded — a small map, not every
  // trade's, so the Rules tab does not ship the whole journal's answers to
  // score one playbook's checklist.
  const positionRulesForBook = new Map<string, PositionRule[]>();
  for (const t of bookTrades) {
    const answers = positionRules.get(t.id);
    if (answers) positionRulesForBook.set(t.id, answers);
  }

  // Only the library plus this one book — a per-playbook page has no use for
  // every other playbook's rules, and shipping them would just be a bigger
  // client payload for the same lookup.
  const lookup = buildPlaybookLookup(
    [{ id: "library", name: "library", rules: library }, book],
    positionRulesForBook,
  );

  const computeCtx = {
    pnlBasis: "net" as const,
    range: breakevenRange,
    rules: lookup.rules,
  };

  return (
    <div className="space-y-5">
      <PlaybookIdentityHeader book={book} />

      <Tabs defaultValue="stats" className="space-y-4">
        <TabsList>
          <TabsTrigger value="stats">Stats</TabsTrigger>
          <TabsTrigger value="rules">Rules</TabsTrigger>
          <TabsTrigger value="trades">Trades</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
        </TabsList>

        <TabsContent value="stats">
          <PlaybookStatsTab
            trades={enrichedBookTrades}
            lookup={lookup}
            computeCtx={computeCtx}
            currency={currency}
            missedCount={missedCount}
          />
        </TabsContent>

        <TabsContent value="rules">
          <PlaybookRulesEditor
            book={book}
            library={library}
            trades={enrichedBookTrades}
            lookup={lookup}
            computeCtx={computeCtx}
            // Every rule some playbook uses — active or not. The "reuse a rule"
            // dialog offers to delete only rules outside all of them.
            linkedRuleIds={[...new Set(playbooks.flatMap((p) => p.rules.map((r) => r.id)))]}
          />
        </TabsContent>

        <TabsContent value="trades">
          <JournalGrid
            trades={bookTrades}
            accounts={accounts}
            fieldDefs={fieldDefs}
            optionsMap={optionsMap}
            playbooks={[book as Playbook]}
            positionRules={positionRulesForBook}
            // Its own remembered filters — not the Trades page's.
            viewKey={`playbook:${book.id}`}
          />
        </TabsContent>

        <TabsContent value="notes">
          <PlaybookNotesPanel playbookId={book.id} notes={notes} todayKey={todayKey} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
