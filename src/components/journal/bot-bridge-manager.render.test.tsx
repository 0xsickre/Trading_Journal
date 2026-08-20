import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BotBridgeManager } from "./bot-bridge-manager";
import type { Account } from "@/lib/journal/types";
import type { BotEventRow } from "@/lib/journal/bot-events";
import type { BotToken, BrokerSymbolMap } from "@/lib/journal/bot-queries";
import type { Json } from "@/lib/supabase/types";

/**
 * The panel exists to make two silent failures loud.
 *
 * One: a bot on cTrader Cloud, where HTTP is dropped without an error, so the
 * bridge looks healthy and delivers nothing. Two: an event the journal refused
 * to turn into a trade, which is only an honest refusal if it is visible and
 * says what to fix. Both are asserted here, along with the rule that a token is
 * shown exactly once.
 */

const registerBotTokenMock = vi.fn();
const revokeBotTokenMock = vi.fn();
const setAccountBrokerIdMock = vi.fn();
const upsertBrokerSymbolMapMock = vi.fn();
const deleteBrokerSymbolMapMock = vi.fn();
const clearQuarantinedEventsMock = vi.fn();

vi.mock("@/app/(app)/settings/bot-actions", () => ({
  registerBotToken: (...a: unknown[]) => registerBotTokenMock(...a),
  revokeBotToken: (...a: unknown[]) => revokeBotTokenMock(...a),
  setAccountBrokerId: (...a: unknown[]) => setAccountBrokerIdMock(...a),
  upsertBrokerSymbolMap: (...a: unknown[]) => upsertBrokerSymbolMapMock(...a),
  deleteBrokerSymbolMap: (...a: unknown[]) => deleteBrokerSymbolMapMock(...a),
  clearQuarantinedEvents: (...a: unknown[]) => clearQuarantinedEventsMock(...a),
}));

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

const toastErrorMock = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...a: unknown[]) => toastErrorMock(...a), success: vi.fn() },
}));

function account(over: Partial<Account> = {}): Account {
  return {
    id: "acc-1",
    name: "Main Account",
    broker: null,
    broker_account_id: null,
    currency: "USD",
    starting_balance: 100_000,
    default_asset_class: null,
    timezone: "Europe/Berlin",
    is_active: true,
    breakeven_from: 0,
    breakeven_to: 0,
    breakeven_unit: "currency",
    default_commission_per_unit: 0,
    default_fee_fixed: 0,
    default_swap_per_day: 0,
    default_stop_pct: null,
    default_target_pct: null,
    ftmo_mode: false,
    ftmo_daily_loss_enabled: false,
    ftmo_daily_loss_pct: 0,
    ftmo_daily_loss_basis: "starting_balance",
    ftmo_max_loss_enabled: false,
    ftmo_max_loss_pct: 0,
    ftmo_profit_target_enabled: false,
    ftmo_profit_target_pct: 0,
    ftmo_min_days_enabled: false,
    ftmo_min_days: 0,
    ftmo_reset_at: null,
    ...over,
  };
}

function token(over: Partial<BotToken> = {}): BotToken {
  return {
    id: "tok-1",
    label: "FTMO desktop",
    token_prefix: "tjb_abc123",
    created_at: "2026-08-20T10:00:00Z",
    last_used_at: null,
    revoked_at: null,
    ...over,
  };
}

function event(over: Partial<BotEventRow> = {}): BotEventRow {
  return {
    id: "e1",
    broker: "ctrader",
    broker_account: "5100123",
    event_key: "ctrader:5100123:order:1:placed",
    kind: "order_placed",
    payload: {} as Json,
    status: "quarantined",
    reason: null,
    position_id: null,
    received_at: "2026-08-21T10:00:00Z",
    ...over,
  };
}

function renderPanel(over: Partial<Parameters<typeof BotBridgeManager>[0]> = {}) {
  return render(
    <BotBridgeManager
      accounts={[account()]}
      tokens={[]}
      symbolMaps={[]}
      quarantined={[]}
      quarantineTotal={0}
      instruments={["EURUSD", "NAS100", "XAUUSD"]}
      {...over}
    />,
  );
}

beforeEach(() => {
  refreshMock.mockClear();
  toastErrorMock.mockClear();
  registerBotTokenMock.mockReset().mockResolvedValue({ ok: true });
  revokeBotTokenMock.mockReset().mockResolvedValue({ ok: true });
  setAccountBrokerIdMock.mockReset().mockResolvedValue({ ok: true });
  upsertBrokerSymbolMapMock.mockReset().mockResolvedValue({ ok: true });
  deleteBrokerSymbolMapMock.mockReset().mockResolvedValue({ ok: true });
  clearQuarantinedEventsMock.mockReset().mockResolvedValue({ ok: true });
});

describe("the Cloud warning", () => {
  it("is on screen before anything else, because a Cloud bot cannot report its own failure", () => {
    renderPanel();
    expect(screen.getByText(/ne sme da radi na cTrader Cloud/i)).toBeInTheDocument();
  });
});

describe("bridge health", () => {
  it("says the bot has never reported when no token has been used", () => {
    renderPanel({ tokens: [token({ last_used_at: null })] });
    expect(screen.getByText("Bot se nikad nije javio")).toBeInTheDocument();
  });

  it("reads health from the live token, not from a revoked one", () => {
    // A revoked token's last heartbeat says nothing about whether the bridge is
    // working now — reporting it as "live" would hide a bridge that stopped the
    // moment the token was pulled.
    renderPanel({
      tokens: [
        token({ id: "old", revoked_at: "2026-08-21T09:00:00Z", last_used_at: new Date().toISOString() }),
        token({ id: "new", last_used_at: null }),
      ],
    });
    expect(screen.getByText("Bot se nikad nije javio")).toBeInTheDocument();
  });

  it("reports a fresh heartbeat as live", () => {
    renderPanel({ tokens: [token({ last_used_at: new Date().toISOString() })] });
    expect(screen.getByText(/Most je živ/i)).toBeInTheDocument();
  });
});

describe("tokens", () => {
  it("refuses to mint a token with no name instead of creating an unidentifiable one", async () => {
    const user = userEvent.setup({ delay: null });
    renderPanel();
    await user.click(screen.getByRole("button", { name: /Napravi token/ }));
    expect(toastErrorMock).toHaveBeenCalled();
    expect(registerBotTokenMock).not.toHaveBeenCalled();
  });

  it("sends only a hash, never the token itself", async () => {
    const user = userEvent.setup({ delay: null });
    renderPanel();
    await user.type(screen.getByPlaceholderText(/Naziv/), "VPS");
    await user.click(screen.getByRole("button", { name: /Napravi token/ }));

    await vi.waitFor(() => expect(registerBotTokenMock).toHaveBeenCalled());
    const arg = registerBotTokenMock.mock.calls[0][0] as {
      label: string;
      tokenHash: string;
      tokenPrefix: string;
    };
    expect(arg.label).toBe("VPS");
    // 64 hex chars and nothing else: if the plaintext ever leaked into this
    // payload it would not match.
    expect(arg.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(arg.tokenPrefix.startsWith("tjb_")).toBe(true);
  });

  it("shows the plaintext once, and says so", async () => {
    const user = userEvent.setup({ delay: null });
    renderPanel();
    await user.type(screen.getByPlaceholderText(/Naziv/), "VPS");
    await user.click(screen.getByRole("button", { name: /Napravi token/ }));

    expect(await screen.findByText(/više se neće prikazati/i)).toBeInTheDocument();
  });

  it("marks a revoked token and offers no second revoke", () => {
    renderPanel({ tokens: [token({ revoked_at: "2026-08-21T09:00:00Z" })] });
    expect(screen.getByText("Opozvan")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Opozovi" })).not.toBeInTheDocument();
  });
});

describe("account mapping", () => {
  it("offers no save until the value actually changed", async () => {
    const user = userEvent.setup({ delay: null });
    renderPanel({ accounts: [account({ broker_account_id: "5100123" })] });

    expect(screen.queryByRole("button", { name: "Sačuvaj" })).not.toBeInTheDocument();
    await user.type(screen.getByPlaceholderText(/broj cTrader naloga/), "4");
    expect(screen.getByRole("button", { name: "Sačuvaj" })).toBeInTheDocument();
  });

  it("names a broker account the bot reported that no journal account claims", () => {
    renderPanel({
      quarantined: [event({ reason: "unmapped_account", broker_account: "5100999" })],
    });
    expect(screen.getByText("5100999")).toBeInTheDocument();
  });
});

describe("symbol mapping", () => {
  const unmapped = event({
    reason: "unmapped_symbol",
    payload: {
      symbol: "US100",
      lot_size: 1,
      volume_in_units: 100,
      quantity: 1,
    } as unknown as Json,
  });

  it("shows the arithmetic and flags that it does not reproduce the broker's own lot count", () => {
    // This is the whole safeguard: an index CFD where the assumed divisor is
    // wrong would put P&L out by orders of magnitude. The panel must not let
    // that be confirmed by reflex.
    renderPanel({ quarantined: [unmapped] });
    expect(screen.getByText(/Ne poklapa se sa cTrader-ovim brojem/)).toBeInTheDocument();
  });

  it("confirms agreement when the divisor does reproduce it", () => {
    renderPanel({
      quarantined: [
        event({
          reason: "unmapped_symbol",
          payload: {
            symbol: "EURUSD",
            lot_size: 100000,
            volume_in_units: 100000,
            quantity: 1,
          } as unknown as Json,
        }),
      ],
    });
    expect(screen.getByText(/Poklapa se sa cTrader-ovim brojem lotova/)).toBeInTheDocument();
  });

  it("counts repeated events for one symbol as a single thing to do", () => {
    renderPanel({ quarantined: [unmapped, { ...unmapped, id: "e2" }, { ...unmapped, id: "e3" }] });
    expect(screen.getByText(/3 događaja u karantinu/)).toBeInTheDocument();
  });

  it("lists an existing mapping with its divisor", () => {
    const map: BrokerSymbolMap = {
      id: "m1",
      broker: "ctrader",
      broker_symbol: "EURUSD",
      instrument: "EURUSD",
      units_per_qty: 100000,
    };
    renderPanel({ symbolMaps: [map] });
    expect(screen.getByText(/jedinica = 1/)).toBeInTheDocument();
  });
});

describe("quarantine list", () => {
  it("says the queue is empty rather than showing an empty table", () => {
    renderPanel();
    expect(screen.getByText("Karantin je prazan.")).toBeInTheDocument();
  });

  it("states each refusal in terms of the fix", () => {
    renderPanel({
      quarantined: [event({ reason: "already_has_fills" })],
      quarantineTotal: 1,
    });
    expect(screen.getByText(/već ima ulazni fill/)).toBeInTheDocument();
  });

  it("admits when it is showing fewer rows than exist", () => {
    // PostgREST truncates at db-max-rows with HTTP 200 and no error, so a
    // partial list that claims to be complete is the default failure here.
    renderPanel({ quarantined: [event()], quarantineTotal: 4300 });
    expect(screen.getByText(/Prikazano najnovijih 1 od 4300/)).toBeInTheDocument();
  });
});
