import { describe, expect, it } from "vitest";
import {
  accountFilterOptions,
  allAccountsScope,
  inAllAccountsScope,
  isPractice,
  cashRowsWithOpening,
  duplicateSettings,
  netFlowByCurrency,
  pickableAccounts,
  primaryAccount,
} from "./account-rules";
import type { Account } from "./types";

const acc = (over: Partial<Account> & { id: string }): Account =>
  ({
    name: over.id,
    currency: "USD",
    starting_balance: 0,
    timezone: "America/New_York",
    is_active: false,
    archived_at: null,
    created_at: "2026-01-01T00:00:00Z",
    ...over,
  }) as Account;

describe("pickableAccounts", () => {
  it("leaves archived accounts out", () => {
    const list = [acc({ id: "a" }), acc({ id: "b", archived_at: "2026-09-01T00:00:00Z" })];
    expect(pickableAccounts(list).map((a) => a.id)).toEqual(["a"]);
  });
  it("keeps the archived account a trade is already filed under", () => {
    const list = [acc({ id: "a" }), acc({ id: "b", archived_at: "2026-09-01T00:00:00Z" })];
    expect(pickableAccounts(list, "b").map((a) => a.id)).toEqual(["a", "b"]);
  });
});

describe("primaryAccount", () => {
  it("never picks an archived default while another account is live", () => {
    const list = [
      acc({ id: "old", is_active: true, archived_at: "2026-09-01T00:00:00Z" }),
      acc({ id: "new" }),
    ];
    expect(primaryAccount(list)?.id).toBe("new");
  });
  it("still answers when every account is archived", () => {
    expect(primaryAccount([acc({ id: "x", archived_at: "2026-09-01T00:00:00Z" })])?.id).toBe("x");
  });
});

describe("duplicateSettings", () => {
  it("copies how the account trades and renames it, with no prop firm's rules (phase X)", () => {
    const src = acc({
      id: "s",
      name: "Tradeify 50K",
      topstep_mode: true,
      topstep_plan: "50K",
      risk_rule_max: 250,
      topstep_reset_at: "2026-09-01T00:00:00Z",
      topstep_payout_at: "2026-09-10T00:00:00Z",
      starting_balance: 50000,
      practice: true,
    });
    const d = duplicateSettings(src);
    expect(d.name).toBe("Tradeify 50K (copy)");
    expect(d.starting_balance).toBe(50000);
    expect(d.practice).toBe(true);
    expect(Object.keys(d).some((k) => k.startsWith("topstep_") || k.startsWith("risk_rule_"))).toBe(false);
    // FTMO is gone (H1): a duplicate carries none of its columns.
    expect(Object.keys(d).some((k) => k.startsWith("ftmo_"))).toBe(false);
  });
});

describe("cashRowsWithOpening", () => {
  const accounts = [
    acc({ id: "a", starting_balance: 10000, created_at: "2026-01-01T00:00:00Z" }),
    acc({ id: "z", starting_balance: 0 }),
  ];
  const events = [
    { id: "e1", account_id: "a", event_type: "deposit", amount: 500, occurred_at: "2026-03-01T12:00:00Z", note: null },
    { id: "e2", account_id: "a", event_type: "withdrawal", amount: -200, occurred_at: "2026-02-01T12:00:00+00:00", note: "x" },
  ];

  it("puts each funded account's opening balance in as a read-only first entry", () => {
    const rows = cashRowsWithOpening(accounts, events);
    expect(rows.map((r) => r.id)).toEqual(["e1", "e2", "opening:a"]);
    const opening = rows.at(-1)!;
    expect(opening).toMatchObject({ type: "opening", amount: 10000, readOnly: true });
  });

  it("adds no opening row for an account that started at zero", () => {
    expect(cashRowsWithOpening(accounts, []).some((r) => r.accountId === "z")).toBe(false);
  });

  it("sums per currency only", () => {
    const rows = cashRowsWithOpening(
      [...accounts, acc({ id: "e", currency: "EUR", starting_balance: 5000 })],
      events,
    );
    const cur = (id: string) => (id === "e" ? "EUR" : "USD");
    expect(netFlowByCurrency(rows, cur)).toEqual([
      { currency: "EUR", net: 5000 },
      { currency: "USD", net: 10300 },
    ]);
  });
});

describe("accountFilterOptions", () => {
  it("keeps archived accounts reachable, last and marked", () => {
    expect(
      accountFilterOptions([
        acc({ id: "old", name: "Old", archived_at: "2026-08-01T00:00:00Z" }),
        acc({ id: "live", name: "Live" }),
      ]),
    ).toEqual([
      { value: "live", label: "Live" },
      { value: "old", label: "Old (archived)" },
    ]);
  });
});

describe("Practice is kept apart from \"All accounts\" (trader, 01.10.2026; its own flag since phase X)", () => {
  const real = { id: "c", name: "Tradeify 50K", archived_at: null, practice: false };
  const xfa = { id: "x", name: "Tradeify 50K funded", archived_at: null, practice: false };
  const practice = { id: "p", name: "Demo 150K", archived_at: null, practice: true };

  it("All is the real accounts", () => {
    expect(allAccountsScope([real, practice, xfa]).map((a) => a.id)).toEqual(["c", "x"]);
    expect(isPractice(practice)).toBe(true);
    expect(isPractice({ ...practice, practice: false })).toBe(false);
  });

  it("a book of nothing but practice shows it", () => {
    expect(allAccountsScope([practice]).map((a) => a.id)).toEqual(["p"]);
  });

  it("rows of a practice account leave All; rows with no account stay", () => {
    const rows = [{ account_id: "c" }, { account_id: "p" }, { account_id: null }];
    expect(inAllAccountsScope(rows, [real, practice])).toEqual([{ account_id: "c" }, { account_id: null }]);
    expect(inAllAccountsScope(rows, [practice])).toEqual(rows);
  });

  it("the picker says which one is practice", () => {
    expect(accountFilterOptions([real, practice]).map((o) => o.label)).toEqual(["Tradeify 50K", "Demo 150K (practice)"]);
  });
});
