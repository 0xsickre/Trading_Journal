/**
 * What an account is holding, so the delete dialog can name it before it goes.
 *
 * "Delete account?" is a question nobody can answer honestly without knowing
 * whether it costs nothing or costs twenty trades. These three counts are what
 * turns the confirmation from a reflex into a decision.
 *
 * Deliberately free of `server-only` and of any Supabase import: the delete
 * dialog is a client component and needs the shape and the predicate. The read
 * that produces these numbers lives in `account-usage-queries.ts`, which is the
 * half that must not cross to the browser.
 */
export type AccountUsage = {
  trades: number;
  cashEvents: number;
  importBatches: number;
};

export const EMPTY_USAGE: AccountUsage = {
  trades: 0,
  cashEvents: 0,
  importBatches: 0,
};

/**
 * True when deleting this account would destroy nothing.
 *
 * A negative count is the sentinel `getAccountUsage` uses for a read that
 * failed, and it deliberately answers `false` here: "we could not find out" must
 * take the same careful path as "there is something here", never the path that
 * offers a one-click delete.
 */
export function usageIsEmpty(u: AccountUsage): boolean {
  return u.trades === 0 && u.cashEvents === 0 && u.importBatches === 0;
}

/** The shape used when a count could not be read at all. */
export const UNKNOWN_USAGE: AccountUsage = {
  trades: -1,
  cashEvents: -1,
  importBatches: -1,
};

/** True when any of the three counts failed to read. */
export function usageIsUnknown(u: AccountUsage): boolean {
  return u.trades < 0 || u.cashEvents < 0 || u.importBatches < 0;
}
