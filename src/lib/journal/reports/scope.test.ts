import { describe, expect, it } from "vitest";
import { accountLabels, accountsInScope } from "./scope";

const acc = (id: string, name: string) => ({ id, name });
const A = acc("acc-1", "Nalog 50K");
const B = acc("acc-2", "Nalog 50K");
const C = acc("acc-3", "Nalog 100K");

describe("report scope", () => {
  it("covers the chosen account, else the whole book", () => {
    expect(accountsInScope([A, B, C], "acc-2")).toEqual([B]);
    expect(accountsInScope([A, B, C], null)).toEqual([A, B, C]);
    // A stale link: the whole book, not nothing.
    expect(accountsInScope([A, B, C], "gone")).toEqual([A, B, C]);
  });

  it("tells same-named accounts apart, and leaves unique names alone", () => {
    const labels = accountLabels([A, B, C]);
    expect(labels.get("acc-3")).toBe("Nalog 100K");
    expect(labels.get("acc-1")).toBe("Nalog 50K · cc-1");
    expect(labels.get("acc-2")).toBe("Nalog 50K · cc-2");
    expect(new Set(labels.values()).size).toBe(3);
  });
});

describe("Practice stays out of the whole book (trader, 01.10.2026)", () => {
  it("no account chosen = the real accounts; Practice when chosen", () => {
    const real = { id: "r", name: "Nalog 50K" };
    const pr = { id: "p", name: "Demo 150K", practice: true };
    expect(accountsInScope([real, pr], null)).toEqual([real]);
    expect(accountsInScope([real, pr], "p")).toEqual([pr]);
  });
});
