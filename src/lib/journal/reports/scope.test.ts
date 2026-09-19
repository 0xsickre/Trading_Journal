import { describe, expect, it } from "vitest";
import {
  accountLabels,
  accountsInScope,
  accountsOfKind,
  asReportKind,
  defaultKind,
  kindOf,
} from "./scope";

const acc = (id: string, name: string, account_kind: "trading" | "backtest") => ({
  id,
  name,
  account_kind,
});
const LIVE = acc("live-1", "FTMO 100k", "trading");
const LIVE2 = acc("live-2", "FTMO 100k", "trading");
const BT = acc("bt-1", "Gold backtest", "backtest");

describe("report scope by account kind", () => {
  it("anything not marked backtest is live", () => {
    expect(kindOf(LIVE)).toBe("live");
    expect(kindOf(BT)).toBe("backtest");
  });

  it("reads a kind from the URL or storage, and nothing else", () => {
    expect(asReportKind("backtest")).toBe("backtest");
    expect(asReportKind("Backtest")).toBeNull();
    expect(asReportKind(null)).toBeNull();
  });

  it("opens on Live when a live trade exists, else Backtest, else All", () => {
    expect(defaultKind([LIVE, BT], ["bt-1", "live-1"])).toBe("live");
    expect(defaultKind([LIVE, BT], ["bt-1"])).toBe("backtest");
    // A live account with no trade does not pull the report onto an empty page.
    expect(defaultKind([LIVE, BT], ["bt-1", null])).toBe("backtest");
    expect(defaultKind([LIVE, BT], [])).toBe("all");
  });

  it("scopes to the chosen account only when it is of the kind", () => {
    expect(accountsOfKind([LIVE, BT], "backtest")).toEqual([BT]);
    expect(accountsOfKind([LIVE, BT], "all")).toEqual([LIVE, BT]);
    expect(accountsInScope([LIVE, LIVE2, BT], "live", "live-2")).toEqual([LIVE2]);
    // A backtest id under Live is a stale link: the whole kind, not nothing.
    expect(accountsInScope([LIVE, LIVE2, BT], "live", "bt-1")).toEqual([LIVE, LIVE2]);
    expect(accountsInScope([LIVE, BT], "backtest", null)).toEqual([BT]);
  });

  it("tells same-named accounts apart, and leaves unique names alone", () => {
    const labels = accountLabels([LIVE, LIVE2, BT, acc("bt-2", "FTMO 100k", "backtest")]);
    expect(labels.get("bt-1")).toBe("Gold backtest");
    expect(labels.get("bt-2")).toBe("FTMO 100k · backtest");
    expect(labels.get("live-1")).toBe("FTMO 100k · live · ve-1");
    expect(labels.get("live-2")).toBe("FTMO 100k · live · ve-2");
    expect(new Set(labels.values()).size).toBe(4);
  });
});
