import { describe, expect, it } from "vitest";
import type { Json } from "@/lib/supabase/types";
import {
  appliedReasonLabel,
  bridgeHealth,
  bridgeHealthLabel,
  cleanBrokerSymbol,
  groupUnmappedSymbols,
  HEARTBEAT_STALE_MS,
  isFixableReason,
  payloadNumber,
  payloadString,
  quarantineReasonLabel,
  tokenDisplayPrefix,
  unitsProposal,
  unmappedAccounts,
  type BotEventRow,
} from "./bot-events";

function ev(over: Partial<BotEventRow> = {}): BotEventRow {
  return {
    id: "e1",
    broker: "ctrader",
    broker_account: "5100123",
    event_key: "ctrader:5100123:order:1:placed",
    kind: "order_placed",
    payload: {},
    status: "quarantined",
    reason: null,
    position_id: null,
    received_at: "2026-08-21T10:00:00Z",
    ...over,
  };
}

describe("reason labels", () => {
  it("names each quarantine reason after its fix, not after the failure", () => {
    expect(quarantineReasonLabel("unmapped_symbol")).toContain("instrument");
    expect(quarantineReasonLabel("unmapped_account")).toContain("nalog");
    expect(quarantineReasonLabel("already_has_fills")).toContain("fill");
    expect(quarantineReasonLabel("malformed_price")).toContain("cenu");
    // The one whose label has to teach, not just name: refusing an edit after the
    // fill looks like a bug until you know it protects R.
    expect(quarantineReasonLabel("not_pending")).toContain("plana");
  });

  /**
   * Every reason the SQL function can write must have a label here, or a real
   * refusal reaches the screen as a raw key nobody can act on. Kept as a list
   * rather than a comment so adding a branch in SQL without a label fails.
   */
  it("has a label for every reason tj_bot_ingest can write", () => {
    const fromSql = [
      "unmapped_account",
      "unmapped_symbol",
      "malformed_symbol",
      "malformed_direction",
      "malformed_volume",
      "malformed_price",
      "malformed_fill",
      "unexpected_status",
      "already_has_fills",
      // 20260821140000_bot_order_modified
      "unknown_order",
      "not_pending",
    ];
    for (const reason of fromSql) {
      expect(quarantineReasonLabel(reason), reason).not.toBe(reason);
    }
  });

  it("passes an unknown reason through rather than hiding it", () => {
    // A reason the database grows later must still reach the screen. Mapping it
    // to a generic message would make a new failure mode invisible.
    expect(quarantineReasonLabel("some_future_reason")).toBe("some_future_reason");
  });

  it("has a label for a missing reason", () => {
    expect(quarantineReasonLabel(null)).toBe("Nepoznat razlog");
  });

  it("returns null for an applied event with nothing worth saying", () => {
    expect(appliedReasonLabel(null)).toBeNull();
  });

  it("explains the applied reasons that change what the row means", () => {
    expect(appliedReasonLabel("was_missed")).toContain("propušten");
    expect(appliedReasonLabel("fill_without_placement")).toContain("fill");
    expect(appliedReasonLabel("unknown_note")).toBe("unknown_note");
  });

  it("marks only the reasons a mapping can clear as fixable", () => {
    expect(isFixableReason("unmapped_symbol")).toBe(true);
    expect(isFixableReason("unmapped_account")).toBe(true);
    // These are not fixable by mapping: the payload itself was wrong, or the
    // trade was in a state the fill did not fit.
    expect(isFixableReason("already_has_fills")).toBe(false);
    expect(isFixableReason("malformed_fill")).toBe(false);
    expect(isFixableReason(null)).toBe(false);
  });
});

describe("cleanBrokerSymbol", () => {
  it("matches the SQL side: uppercase, alphanumerics only", () => {
    expect(cleanBrokerSymbol("eurusd")).toBe("EURUSD");
    expect(cleanBrokerSymbol("US500.cash")).toBe("US500CASH");
    expect(cleanBrokerSymbol("EUR/USD.pro")).toBe("EURUSDPRO");
    expect(cleanBrokerSymbol("")).toBe("");
    expect(cleanBrokerSymbol(null)).toBe("");
    expect(cleanBrokerSymbol(undefined)).toBe("");
  });
});

describe("payload readers", () => {
  it("reads strings and numbers when present", () => {
    const p = { symbol: "EURUSD", lot_size: 100000 } as unknown as Json;
    expect(payloadString(p, "symbol")).toBe("EURUSD");
    expect(payloadNumber(p, "lot_size")).toBe(100000);
  });

  it("answers null instead of throwing on a payload with no shape", () => {
    // A malformed payload must still render as a row in the quarantine list;
    // that is the only place a human can see that it arrived at all.
    for (const p of [null, 42, "text", [1, 2]] as unknown as Json[]) {
      expect(payloadString(p, "symbol")).toBeNull();
      expect(payloadNumber(p, "lot_size")).toBeNull();
    }
  });

  it("rejects wrong-typed and non-finite values", () => {
    const p = { symbol: 5, lot_size: "100000", n: Number.NaN } as unknown as Json;
    expect(payloadString(p, "symbol")).toBeNull();
    expect(payloadNumber(p, "lot_size")).toBeNull();
    expect(payloadNumber(p, "n")).toBeNull();
  });

  it("treats an empty string as absent", () => {
    expect(payloadString({ symbol: "" } as unknown as Json, "symbol")).toBeNull();
  });
});

describe("unitsProposal", () => {
  it("confirms the divisor when it reproduces the broker's own quantity", () => {
    // One standard EURUSD lot: 100 000 units / 100 000 = 1.00, and cTrader says
    // 1.00 too. The agreement is the evidence the confirmation rests on.
    const p = {
      symbol: "EURUSD",
      lot_size: 100000,
      volume_in_units: 100000,
      quantity: 1,
    } as unknown as Json;

    const r = unitsProposal(p);
    expect(r.brokerSymbol).toBe("EURUSD");
    expect(r.impliedQty).toBe(1);
    expect(r.agreesWithBroker).toBe(true);
  });

  it("survives fractional lots", () => {
    const p = {
      symbol: "XAUUSD",
      lot_size: 100,
      volume_in_units: 25,
      quantity: 0.25,
    } as unknown as Json;

    expect(unitsProposal(p).agreesWithBroker).toBe(true);
    expect(unitsProposal(p).impliedQty).toBe(0.25);
  });

  it("withholds agreement when the arithmetic does not reproduce the quantity", () => {
    // This is the case the whole mechanism exists for: an index CFD where the
    // broker's lot definition is not the divisor we assumed. Confirming here
    // would put the P&L out by orders of magnitude.
    const p = {
      symbol: "US100",
      lot_size: 1,
      volume_in_units: 100,
      quantity: 1,
    } as unknown as Json;

    const r = unitsProposal(p);
    expect(r.impliedQty).toBe(100);
    expect(r.agreesWithBroker).toBe(false);
  });

  it("does not claim agreement when either number is missing", () => {
    expect(unitsProposal({ symbol: "X", volume_in_units: 100 } as unknown as Json).agreesWithBroker)
      .toBe(false);
    expect(unitsProposal({ symbol: "X", lot_size: 100 } as unknown as Json).agreesWithBroker)
      .toBe(false);
    expect(unitsProposal({} as unknown as Json).agreesWithBroker).toBe(false);
  });

  it("refuses to divide by a zero or negative lot size", () => {
    const r = unitsProposal({
      symbol: "X",
      lot_size: 0,
      volume_in_units: 100,
      quantity: 1,
    } as unknown as Json);
    expect(r.impliedQty).toBeNull();
    expect(r.agreesWithBroker).toBe(false);
  });
});

describe("groupUnmappedSymbols", () => {
  const p = (symbol: string) =>
    ({ symbol, lot_size: 100000, volume_in_units: 100000, quantity: 1 }) as unknown as Json;

  it("collapses many events on one symbol into one thing to do", () => {
    const rows = groupUnmappedSymbols([
      ev({ id: "1", reason: "unmapped_symbol", payload: p("US100") }),
      ev({ id: "2", reason: "unmapped_symbol", payload: p("US100") }),
      ev({ id: "3", reason: "unmapped_symbol", payload: p("US100") }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].brokerSymbol).toBe("US100");
    expect(rows[0].count).toBe(3);
  });

  it("keeps symbols apart and sorts them", () => {
    const rows = groupUnmappedSymbols([
      ev({ id: "1", reason: "unmapped_symbol", payload: p("US500") }),
      ev({ id: "2", reason: "unmapped_symbol", payload: p("EURUSD") }),
    ]);
    expect(rows.map((r) => r.brokerSymbol)).toEqual(["EURUSD", "US500"]);
  });

  it("separates the same symbol on different brokers", () => {
    const rows = groupUnmappedSymbols([
      ev({ id: "1", broker: "ctrader", reason: "unmapped_symbol", payload: p("US100") }),
      ev({ id: "2", broker: "other", reason: "unmapped_symbol", payload: p("US100") }),
    ]);
    expect(rows).toHaveLength(2);
  });

  it("ignores events quarantined for any other reason", () => {
    expect(
      groupUnmappedSymbols([
        ev({ reason: "unmapped_account", payload: p("US100") }),
        ev({ reason: "already_has_fills", payload: p("US100") }),
        ev({ reason: null, payload: p("US100") }),
      ]),
    ).toEqual([]);
  });

  it("skips an unmapped-symbol event whose payload has no symbol to map", () => {
    // Nothing can be done with it from this panel, so offering a row that maps
    // an empty string would be an action that cannot help.
    expect(groupUnmappedSymbols([ev({ reason: "unmapped_symbol", payload: {} })])).toEqual([]);
  });
});

describe("unmappedAccounts", () => {
  it("lists each unknown broker account once, sorted", () => {
    expect(
      unmappedAccounts([
        ev({ reason: "unmapped_account", broker_account: "5100999" }),
        ev({ reason: "unmapped_account", broker_account: "5100123" }),
        ev({ reason: "unmapped_account", broker_account: "5100123" }),
        ev({ reason: "unmapped_symbol", broker_account: "5100777" }),
      ]),
    ).toEqual(["5100123", "5100999"]);
  });

  it("is empty when every account resolved", () => {
    expect(unmappedAccounts([ev({ reason: null, status: "applied" })])).toEqual([]);
  });
});

describe("bridgeHealth", () => {
  const now = new Date("2026-08-21T12:00:00Z");

  it("reports a bridge that has never spoken", () => {
    expect(bridgeHealth(null, now)).toBe("never");
    expect(bridgeHealthLabel("never")).toContain("nikad");
  });

  it("reports a recent heartbeat as live", () => {
    expect(bridgeHealth("2026-08-21T11:50:00Z", now)).toBe("live");
    expect(bridgeHealthLabel("live")).toContain("živ");
  });

  it("reports silence past the window as stale", () => {
    // The failure worth catching is a bot on cTrader Cloud, where HTTP is
    // dropped without an error and the beat never arrives at all.
    expect(bridgeHealth("2026-08-21T10:00:00Z", now)).toBe("stale");
    expect(bridgeHealthLabel("stale")).toContain("45");
  });

  it("puts the boundary exactly at the stale window", () => {
    const edge = new Date(now.getTime() - HEARTBEAT_STALE_MS).toISOString();
    expect(bridgeHealth(edge, now)).toBe("live");
    const past = new Date(now.getTime() - HEARTBEAT_STALE_MS - 1).toISOString();
    expect(bridgeHealth(past, now)).toBe("stale");
  });

  it("treats an unparseable timestamp as never seen", () => {
    expect(bridgeHealth("not a date", now)).toBe("never");
  });
});

describe("tokenDisplayPrefix", () => {
  it("keeps enough of the token to recognise it and not enough to use it", () => {
    expect(tokenDisplayPrefix("tjb_abcdefghijklmnop")).toBe("tjb_abcdef");
  });

  it("does not invent characters for a short string", () => {
    expect(tokenDisplayPrefix("tjb_ab")).toBe("tjb_ab");
  });
});
