/**
 * Reading the bot bridge's event log.
 *
 * The bot reports what the broker did; this module turns its refusals into
 * something a human can act on. Every function here is pure — the queries live
 * in `bot-queries.ts` — so the rules below are testable without a database.
 *
 * The governing idea is the repo's own: a machine feed must refuse rather than
 * guess. When the bot sends a symbol or an account the journal cannot resolve,
 * the event is quarantined and NO trade is written. That is only honest if the
 * quarantine is visible and says what to fix, which is what this module is for.
 */

import type { Json } from "@/lib/supabase/types";

export type BotEventRow = {
  id: string;
  broker: string;
  broker_account: string;
  event_key: string;
  kind: string;
  payload: Json;
  status: string;
  reason: string | null;
  position_id: string | null;
  received_at: string;
};

/**
 * Why an event did not become a trade, in the language of the fix.
 *
 * Deliberately not a generic "greška": every one of these has a different
 * remedy, and a quarantine list that cannot tell them apart is a list nobody
 * works through.
 */
const QUARANTINE_REASONS: Record<string, string> = {
  unmapped_account: "Nalog nije mapiran — poveži broj cTrader naloga sa nalogom u dnevniku",
  unmapped_symbol: "Simbol nije mapiran — dodeli mu instrument i količinu po lotu",
  malformed_symbol: "Bot je poslao prazan simbol",
  malformed_direction: "Bot je poslao nepoznat smer (ni Buy ni Sell)",
  malformed_volume: "Volumen se ne može pretvoriti u količinu",
  malformed_price: "Order nema upotrebljivu ulaznu cenu",
  malformed_fill: "Fill nema upotrebljivu cenu ili vreme",
  unexpected_status: "Trejd nije bio ni planiran ni propušten — fill nije upisan",
  already_has_fills: "Trejd već ima ulazni fill — drugi nije upisan",
  unknown_order: "Izmena ordera koji dnevnik nikad nije video — ništa nije napravljeno od nje",
  not_pending:
    "Order je već ispunjen ili otkazan — izmena nije primenjena, jer posle ulaska pomeranje stopa " +
    "je vođenje trejda, a ne promena plana",
  unknown_position: "Izmena pozicije koju dnevnik nikad nije video — ništa nije napravljeno od nje",
  not_open: "Trejd nije otvoren — izmena take profita nije primenjena",
  malformed_excursion: "Bot nije poslao nijednu upotrebljivu MAE/MFE cenu",
};

/** Notes on events that DID apply, where the outcome deserves a word. */
const APPLIED_REASONS: Record<string, string> = {
  was_missed: "Bio označen kao propušten, pa se ipak ispunio — razlog propuštanja je sačuvan",
  fill_without_placement: "Bot nije video postavljanje ordera, samo fill",
  already_present: "Order je već bio u dnevniku — ništa nije prepisano",
  already_missed: "Order je već bio označen kao propušten — ništa nije promenjeno",
  manual_kept:
    "MAE/MFE si uneo ručno, pa botova mera nije upisana — ručni unos pobeđuje. " +
    "Obriši ta dva polja na trejdu ako hoćeš da bot preuzme nazad",
};

export function quarantineReasonLabel(reason: string | null): string {
  if (!reason) return "Nepoznat razlog";
  return QUARANTINE_REASONS[reason] ?? reason;
}

export function appliedReasonLabel(reason: string | null): string | null {
  if (!reason) return null;
  return APPLIED_REASONS[reason] ?? reason;
}

/** True when the reason is one a human can clear by adding a mapping. */
export function isFixableReason(reason: string | null): boolean {
  return reason === "unmapped_symbol" || reason === "unmapped_account";
}

// --- payload reading ---------------------------------------------------------
//
// The payload is whatever the bot sent. It is never trusted to have a shape:
// these readers answer null rather than throwing, because a malformed payload
// must still render as a row in the quarantine list.

function bag(payload: Json): Record<string, unknown> | null {
  if (payload == null || typeof payload !== "object" || Array.isArray(payload)) return null;
  return payload as Record<string, unknown>;
}

export function payloadString(payload: Json, key: string): string | null {
  const v = bag(payload)?.[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function payloadNumber(payload: Json, key: string): number | null {
  const v = bag(payload)?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Broker symbol as the database stores and looks it up: uppercase, alphanumerics only. */
export function cleanBrokerSymbol(raw: string | null | undefined): string {
  return (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// --- the units_per_qty proposal ----------------------------------------------

export type UnitsProposal = {
  brokerSymbol: string;
  /** Symbol.LotSize as cTrader reported it — the proposed divisor. */
  lotSize: number | null;
  volumeInUnits: number | null;
  /** cTrader's own units→lots answer, used to check the proposal, not to set it. */
  quantity: number | null;
  /** volumeInUnits / lotSize, i.e. what the journal would record as qty. */
  impliedQty: number | null;
  /**
   * True when the proposed divisor reproduces cTrader's own quantity.
   *
   * This is the whole point of sending both numbers. It does NOT prove the
   * divisor is right for the journal — "one lot" on an index CFD is the
   * broker's contract definition and need not be what the journal counts as one
   * contract — but it does prove the arithmetic is self-consistent, which turns
   * the confirmation from an act of faith into a reading.
   */
  agreesWithBroker: boolean;
};

const QTY_TOLERANCE = 1e-6;

export function unitsProposal(payload: Json): UnitsProposal {
  const lotSize = payloadNumber(payload, "lot_size");
  const volumeInUnits = payloadNumber(payload, "volume_in_units");
  const quantity = payloadNumber(payload, "quantity");

  const impliedQty =
    lotSize != null && lotSize > 0 && volumeInUnits != null ? volumeInUnits / lotSize : null;

  const agreesWithBroker =
    impliedQty != null && quantity != null && Math.abs(impliedQty - quantity) < QTY_TOLERANCE;

  return {
    brokerSymbol: cleanBrokerSymbol(payloadString(payload, "symbol")),
    lotSize,
    volumeInUnits,
    quantity,
    impliedQty,
    agreesWithBroker,
  };
}

// --- grouping ----------------------------------------------------------------

export type UnmappedSymbolGroup = {
  brokerSymbol: string;
  broker: string;
  count: number;
  /** The most recent event carrying this symbol — the one whose numbers we show. */
  proposal: UnitsProposal;
};

/**
 * Unmapped symbols, one row per symbol rather than one per event.
 *
 * A single unmapped symbol traded ten times produces ten quarantined events and
 * exactly one thing to do. Grouping is what keeps the panel a to-do list
 * instead of a log.
 */
export function groupUnmappedSymbols(events: BotEventRow[]): UnmappedSymbolGroup[] {
  const groups = new Map<string, UnmappedSymbolGroup>();

  for (const e of events) {
    if (e.reason !== "unmapped_symbol") continue;

    const symbol = cleanBrokerSymbol(payloadString(e.payload, "symbol"));
    if (!symbol) continue;

    const key = `${e.broker}:${symbol}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }

    groups.set(key, {
      brokerSymbol: symbol,
      broker: e.broker,
      count: 1,
      proposal: unitsProposal(e.payload),
    });
  }

  return [...groups.values()].sort((a, b) => a.brokerSymbol.localeCompare(b.brokerSymbol));
}

/** Broker account numbers the bot reported that no journal account claims. */
export function unmappedAccounts(events: BotEventRow[]): string[] {
  const seen = new Set<string>();
  for (const e of events) {
    if (e.reason === "unmapped_account") seen.add(e.broker_account);
  }
  return [...seen].sort();
}

// --- bridge health -----------------------------------------------------------

export type BridgeHealth = "never" | "live" | "stale";

/**
 * How long silence is allowed before it is reported as silence.
 *
 * Generous against the bot's default 15-minute heartbeat, because a missed beat
 * is usually a restart, not a dead bridge. The failure this exists to catch is
 * not a late heartbeat -- it is a bot on cTrader Cloud, where HTTP is dropped
 * silently and the beat never arrives at all.
 */
export const HEARTBEAT_STALE_MS = 45 * 60 * 1000;

export function bridgeHealth(lastUsedAt: string | null, now: Date): BridgeHealth {
  if (!lastUsedAt) return "never";
  const seen = new Date(lastUsedAt).getTime();
  if (!Number.isFinite(seen)) return "never";
  return now.getTime() - seen > HEARTBEAT_STALE_MS ? "stale" : "live";
}

export function bridgeHealthLabel(health: BridgeHealth): string {
  switch (health) {
    case "live":
      return "Most je živ";
    case "stale":
      return "Bot se nije javio duže od 45 minuta";
    case "never":
      return "Bot se nikad nije javio";
  }
}

/**
 * A token string the bot can carry.
 *
 * Generated in the browser and shown once; only its SHA-256 is sent to the
 * server, so no server log can ever hold a working credential. `tjb_` prefixes
 * it so a leaked string is recognisable as this system's token when it turns up
 * somewhere it should not be.
 */
export const TOKEN_PREFIX = "tjb_";

export function tokenDisplayPrefix(token: string): string {
  return token.slice(0, TOKEN_PREFIX.length + 6);
}
