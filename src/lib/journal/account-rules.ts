/**
 * Account rules shared by the server and the pickers — pure, client-safe.
 */

import type { Account } from "./types";
import { toEpoch } from "./time";

/** True when the account has been archived. */
export function isArchived(a: Pick<Account, "archived_at">): boolean {
  return a.archived_at != null;
}

/**
 * The accounts a picker offers: the ones not archived.
 *
 * `keepId` stays in even when archived, so a trade already filed under an
 * archived account still shows that account in its own form instead of an
 * empty select that would re-file it on save.
 */
export function pickableAccounts<T extends Pick<Account, "id" | "archived_at">>(
  accounts: readonly T[],
  keepId?: string | null,
): T[] {
  return accounts.filter((a) => !isArchived(a) || a.id === keepId);
}

/**
 * The default context account: the default one if it is not archived, else
 * the first one not archived, else the first of all (every account archived is
 * still a book with a timezone and a currency).
 */
export function primaryAccount<T extends Pick<Account, "is_active" | "archived_at">>(
  accounts: readonly T[],
): T | null {
  const live = accounts.filter((a) => !isArchived(a));
  return live.find((a) => a.is_active) ?? live[0] ?? accounts[0] ?? null;
}

/**
 * The settings a duplicate copies: everything that describes HOW the account
 * trades, nothing that describes what it holds. The name gets " (copy)", the
 * starting balance is the source's (a new challenge of the same size is the
 * usual reason to duplicate), and the challenge restarts — no `ftmo_reset_at`.
 */
export function duplicateSettings(src: Account) {
  return {
    name: `${src.name} (copy)`,
    account_kind: src.account_kind,
    currency: src.currency,
    starting_balance: src.starting_balance,
    timezone: src.timezone,
    default_asset_class: src.default_asset_class,
    breakeven_from: src.breakeven_from,
    breakeven_to: src.breakeven_to,
    breakeven_unit: src.breakeven_unit,
    default_commission_per_unit: src.default_commission_per_unit,
    default_fee_fixed: src.default_fee_fixed,
    default_swap_per_day: src.default_swap_per_day,
    default_stop_pct: src.default_stop_pct,
    default_target_pct: src.default_target_pct,
    ftmo_mode: src.ftmo_mode,
    ftmo_daily_loss_enabled: src.ftmo_daily_loss_enabled,
    ftmo_daily_loss_pct: src.ftmo_daily_loss_pct,
    ftmo_daily_loss_basis: src.ftmo_daily_loss_basis,
    ftmo_max_loss_enabled: src.ftmo_max_loss_enabled,
    ftmo_max_loss_pct: src.ftmo_max_loss_pct,
    ftmo_profit_target_enabled: src.ftmo_profit_target_enabled,
    ftmo_profit_target_pct: src.ftmo_profit_target_pct,
    ftmo_min_days_enabled: src.ftmo_min_days_enabled,
    ftmo_min_days: src.ftmo_min_days,
  };
}

/** One row of the deposits table: a real cash event, or an account's opening balance. */
export type CashRow = {
  id: string;
  accountId: string;
  /** UTC instant; for the opening row, when the account was created. */
  at: string;
  type: "opening" | "deposit" | "withdrawal" | "payout" | "adjustment";
  amount: number;
  note: string | null;
  /** True for the derived opening row, which is edited through the account. */
  readOnly: boolean;
};

/**
 * The deposits list with each account's starting balance as its first entry.
 *
 * DERIVED, never stored. Equity already adds `starting_balance`; storing it as
 * a deposit too would count it twice. It is shown here because a trader reads
 * the money that went into an account as one list, and the first entry of that
 * list is the balance it opened with. Newest first, like the events.
 */
export function cashRowsWithOpening(
  accounts: readonly Pick<Account, "id" | "starting_balance" | "created_at">[],
  events: readonly {
    id: string;
    account_id: string;
    event_type: string;
    amount: number;
    occurred_at: string;
    note: string | null;
  }[],
): CashRow[] {
  const rows: CashRow[] = events.map((e) => ({
    id: e.id,
    accountId: e.account_id,
    at: e.occurred_at,
    type: e.event_type as CashRow["type"],
    amount: e.amount,
    note: e.note,
    readOnly: false,
  }));
  for (const a of accounts) {
    if (!(a.starting_balance > 0)) continue;
    rows.push({
      id: `opening:${a.id}`,
      accountId: a.id,
      at: a.created_at,
      type: "opening",
      amount: a.starting_balance,
      note: null,
      readOnly: true,
    });
  }
  // As instants: ISO strings from PostgREST and from the app differ in shape
  // and do not order correctly as text (see `toEpoch`).
  return rows.sort((x, y) => toEpoch(y.at) - toEpoch(x.at));
}

/** Net flow per currency — sums are only meaningful within one currency. */
export function netFlowByCurrency(
  rows: readonly CashRow[],
  currencyOf: (accountId: string) => string,
): { currency: string; net: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const c = currencyOf(r.accountId);
    m.set(c, (m.get(c) ?? 0) + r.amount);
  }
  return [...m.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, net]) => ({ currency, net }));
}

/**
 * The options of an account FILTER (Dashboard, Calendar, Trades): every
 * account, the archived ones last and marked. A filter looks at history, and an
 * archived account's trades are still history — hiding it there would leave its
 * results reachable only through "All accounts". Entry pickers use
 * `pickableAccounts` instead.
 */
export function accountFilterOptions(
  accounts: readonly Pick<Account, "id" | "name" | "archived_at">[],
): { value: string; label: string }[] {
  return [
    ...accounts.filter((a) => !isArchived(a)).map((a) => ({ value: a.id, label: a.name })),
    ...accounts.filter(isArchived).map((a) => ({ value: a.id, label: `${a.name} (archived)` })),
  ];
}
