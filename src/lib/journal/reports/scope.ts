/**
 * Which accounts a report is about.
 *
 * Every account in the book is a Topstep account since H2 (the backtest kind
 * went with decision I5), so a report covers them all or one of them.
 * Everything that pools across accounts — the currency, the percentage base,
 * the breakeven band — is taken over the accounts in scope, never over all.
 */

import { allAccountsScope } from "../account-rules";
import type { Account } from "../types";

type NamedAccount = Pick<Account, "id" | "name"> & Partial<Pick<Account, "topstep_mode" | "topstep_stage">>;

/**
 * The accounts a report covers: the one chosen, else every real account —
 * Practice is read by choosing it (`allAccountsScope`, trader 01.10.2026). An
 * id that names no account (a stale link) falls back to that whole book rather
 * than producing a report about nothing.
 */
export function accountsInScope<A extends NamedAccount>(
  accounts: readonly A[],
  accountId: string | null | undefined,
): A[] {
  const chosen = accountId ? accounts.find((a) => a.id === accountId) : undefined;
  return chosen ? [chosen] : allAccountsScope(accounts);
}

/**
 * A label per account that tells same-named accounts apart.
 *
 * Two accounts both called "Topstep 50K" — a combine and the funded account —
 * used to share one row in the Account breakdown and one entry in the picker.
 * A name used once stays as it is; a repeated name gets the last four
 * characters of the id.
 */
export function accountLabels(accounts: readonly NamedAccount[]): Map<string, string> {
  const byName = new Map<string, number>();
  for (const a of accounts) byName.set(a.name, (byName.get(a.name) ?? 0) + 1);

  const out = new Map<string, string>();
  for (const a of accounts) {
    out.set(a.id, (byName.get(a.name) ?? 0) <= 1 ? a.name : `${a.name} · ${a.id.slice(-4)}`);
  }
  return out;
}
