import { describe, expect, it } from "vitest";
import {
  accountFilterOptions,
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
    account_kind: "trading",
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
  it("copies how the account trades, renames it, and restarts the challenge", () => {
    const src = acc({ id: "s", name: "FTMO 100k", ftmo_mode: true, ftmo_max_loss_pct: 10, ftmo_reset_at: "2026-05-01T00:00:00Z", starting_balance: 100000 });
    const d = duplicateSettings(src);
    expect(d.name).toBe("FTMO 100k (copy)");
    expect(d.ftmo_mode).toBe(true);
    expect(d.ftmo_max_loss_pct).toBe(10);
    expect(d.starting_balance).toBe(100000);
    expect("ftmo_reset_at" in d).toBe(false);
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
