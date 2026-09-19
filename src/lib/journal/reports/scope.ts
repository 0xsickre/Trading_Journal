/**
 * Which accounts a report is about.
 *
 * Backtests and live trading are different books: a replayed 2018 gold trade
 * and a funded-account trade from this week answer different questions, and
 * pooling them — which the report did for every account by default — gave
 * numbers describing neither. The README promised they never mix.
 *
 * So a report is scoped by account KIND first (Live | Backtest | All), then
 * optionally to one account of that kind. Everything that pools across
 * accounts — the currency, the percentage base, the breakeven band — is taken
 * over the accounts in scope, never over all of them: a EUR live account used
 * to block a USD backtest report with a mixed-currency warning.
 */

import type { Account } from "../types";

export type ReportKind = "live" | "backtest" | "all";

export const REPORT_KINDS: readonly { value: ReportKind; label: string }[] = [
  { value: "live", label: "Live" },
  { value: "backtest", label: "Backtest" },
  { value: "all", label: "All" },
];

type KindedAccount = Pick<Account, "id" | "name" | "account_kind">;

/** An account's report kind. Anything not marked backtest is a live account. */
export function kindOf(account: Pick<Account, "account_kind">): Exclude<ReportKind, "all"> {
  return account.account_kind === "backtest" ? "backtest" : "live";
}

/** A `kind` read from the URL or storage; anything else is null. */
export function asReportKind(raw: string | null | undefined): ReportKind | null {
  return raw === "live" || raw === "backtest" || raw === "all" ? raw : null;
}

/**
 * The kind a report opens on when nothing chose one: Live when any closed trade
 * is on a live account, otherwise Backtest when a backtest has any, otherwise
 * All (an empty journal).
 */
export function defaultKind(
  accounts: readonly KindedAccount[],
  closedTradeAccountIds: readonly (string | null)[],
): ReportKind {
  const kindById = new Map(accounts.map((a) => [a.id, kindOf(a)]));
  const kinds = new Set(
    closedTradeAccountIds.map((id) => (id ? kindById.get(id) : undefined)),
  );
  if (kinds.has("live")) return "live";
  if (kinds.has("backtest")) return "backtest";
  return "all";
}

/** The accounts of a kind, in the order given. */
export function accountsOfKind<A extends KindedAccount>(
  accounts: readonly A[],
  kind: ReportKind,
): A[] {
  return kind === "all" ? [...accounts] : accounts.filter((a) => kindOf(a) === kind);
}

/**
 * The accounts a report covers: the one chosen when it belongs to the kind,
 * else every account of the kind. An account id that is not of this kind (a
 * stale link, a switched kind) falls back to the whole kind rather than
 * producing a report about nothing.
 */
export function accountsInScope<A extends KindedAccount>(
  accounts: readonly A[],
  kind: ReportKind,
  accountId: string | null | undefined,
): A[] {
  const ofKind = accountsOfKind(accounts, kind);
  const chosen = accountId ? ofKind.find((a) => a.id === accountId) : undefined;
  return chosen ? [chosen] : ofKind;
}

/**
 * A label per account that tells same-named accounts apart.
 *
 * Two accounts both called "FTMO 100k" — a challenge and the funded account —
 * used to share one row in the Account breakdown and one entry in the picker.
 * A name used once stays as it is; a repeated name gets the kind and, if that
 * still repeats, the last four characters of the id.
 */
export function accountLabels(accounts: readonly KindedAccount[]): Map<string, string> {
  const count = (key: (a: KindedAccount) => string) => {
    const m = new Map<string, number>();
    for (const a of accounts) m.set(key(a), (m.get(key(a)) ?? 0) + 1);
    return m;
  };
  const byName = count((a) => a.name);
  const withKind = (a: KindedAccount) =>
    `${a.name} · ${kindOf(a) === "backtest" ? "backtest" : "live"}`;
  const byNameKind = count(withKind);

  const out = new Map<string, string>();
  for (const a of accounts) {
    if ((byName.get(a.name) ?? 0) <= 1) out.set(a.id, a.name);
    else if ((byNameKind.get(withKind(a)) ?? 0) <= 1) out.set(a.id, withKind(a));
    else out.set(a.id, `${withKind(a)} · ${a.id.slice(-4)}`);
  }
  return out;
}
