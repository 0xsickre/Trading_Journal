"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bot, Check, Copy, Plus, ShieldAlert, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  bridgeHealth,
  bridgeHealthLabel,
  cleanBrokerSymbol,
  groupUnmappedSymbols,
  quarantineReasonLabel,
  TOKEN_PREFIX,
  tokenDisplayPrefix,
  unmappedAccounts,
  type BotEventRow,
} from "@/lib/journal/bot-events";
import { normalizeInstrumentSymbol } from "@/lib/journal/instrument-aliases";
import type { Account } from "@/lib/journal/types";
import type { BotToken, BrokerSymbolMap } from "@/lib/journal/bot-queries";
import {
  clearQuarantinedEvents,
  deleteBrokerSymbolMap,
  registerBotToken,
  revokeBotToken,
  setAccountBrokerId,
  upsertBrokerSymbolMap,
} from "@/app/(app)/settings/bot-actions";

function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done?: () => void) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) toast.error(res.error ?? "Nije uspelo");
      else {
        done?.();
        router.refresh();
      }
    });
  return { pending, run };
}

/**
 * Generate the token here, in the browser, and hash it here too.
 *
 * The server is handed only the SHA-256, so no server log, error report or RSC
 * payload can ever contain a working credential. The trade this buys is that a
 * lost token cannot be recovered, only replaced — which is why it is shown once
 * and loudly.
 */
async function mintToken(): Promise<{ token: string; hash: string }> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token =
    TOKEN_PREFIX +
    btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const hash = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return { token, hash };
}

export function BotBridgeManager({
  accounts,
  tokens,
  symbolMaps,
  quarantined,
  quarantineTotal,
  instruments,
}: {
  accounts: Account[];
  tokens: BotToken[];
  symbolMaps: BrokerSymbolMap[];
  quarantined: BotEventRow[];
  quarantineTotal: number | null;
  instruments: string[];
}) {
  const now = new Date();

  const liveToken = tokens.find((t) => !t.revoked_at) ?? null;
  const health = bridgeHealth(liveToken?.last_used_at ?? null, now);
  const unmappedSymbols = useMemo(() => groupUnmappedSymbols(quarantined), [quarantined]);
  const orphanAccounts = useMemo(() => unmappedAccounts(quarantined), [quarantined]);

  return (
    <div className="space-y-4">
      <CloudWarning />
      <BridgeStatus health={health} lastSeen={liveToken?.last_used_at ?? null} />
      <TokenSection tokens={tokens} />
      <AccountMapping accounts={accounts} orphans={orphanAccounts} />
      <SymbolMapping
        maps={symbolMaps}
        instruments={instruments}
        unmapped={unmappedSymbols}
      />
      <QuarantineList rows={quarantined} total={quarantineTotal} />
    </div>
  );
}

/**
 * The one failure mode that cannot be detected from inside the bot.
 *
 * cTrader Cloud drops HTTP without raising, so a cloud-hosted bridge looks
 * perfectly healthy while delivering nothing. Stated at the top of the panel
 * because by the time someone reads the quarantine list they are already
 * assuming events arrive.
 */
function CloudWarning() {
  return (
    <div className="flex gap-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
      <div>
        <p className="font-medium">Bot ne sme da radi na cTrader Cloud-u</p>
        <p className="text-muted-foreground">
          Cloud instance ne šalju HTTP i ne prijavljuju grešku kad ne pošalju — bot bi izgledao
          zdravo a ne bi isporučio ništa. Pusti ga na desktopu ili VPS-u.
        </p>
      </div>
    </div>
  );
}

function BridgeStatus({
  health,
  lastSeen,
}: {
  health: ReturnType<typeof bridgeHealth>;
  lastSeen: string | null;
}) {
  const tone =
    health === "live"
      ? "text-emerald-600 dark:text-emerald-400"
      : health === "stale"
        ? "text-amber-600 dark:text-amber-400"
        : "text-muted-foreground";

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-3 py-4">
        <Bot className={`size-5 ${tone}`} />
        <span className={`font-medium ${tone}`}>{bridgeHealthLabel(health)}</span>
        {lastSeen ? (
          <span className="text-sm text-muted-foreground">
            Poslednje javljanje: {new Date(lastSeen).toLocaleString("sr-RS")}
          </span>
        ) : null}
      </CardContent>
    </Card>
  );
}

function TokenSection({ tokens }: { tokens: BotToken[] }) {
  const { pending, run } = useAction();
  const [label, setLabel] = useState("");
  const [minted, setMinted] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const create = async () => {
    if (!label.trim()) {
      toast.error("Daj tokenu naziv, da znaš koji je koji");
      return;
    }
    const { token, hash } = await mintToken();
    run(
      () =>
        registerBotToken({
          label: label.trim(),
          tokenHash: hash,
          tokenPrefix: tokenDisplayPrefix(token),
        }),
      () => {
        setMinted(token);
        setLabel("");
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Tokeni</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Naziv, npr. „FTMO desktop”"
            className="max-w-xs"
            disabled={pending}
          />
          <Button onClick={create} disabled={pending}>
            <Plus className="size-4" />
            Napravi token
          </Button>
        </div>

        {minted ? (
          <div className="space-y-2 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3">
            <p className="text-sm font-medium">
              Kopiraj token sada — više se neće prikazati
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="break-all rounded bg-muted px-2 py-1 text-xs">{minted}</code>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard.writeText(minted);
                  setCopied(true);
                }}
              >
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied ? "Kopirano" : "Kopiraj"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Nalepi ga u parametar <strong>Bot Token</strong> u cTrader-u. Čuva se samo njegov
              otisak, pa izgubljen token može da se zameni ali ne i pročita.
            </p>
          </div>
        ) : null}

        {tokens.length === 0 ? (
          <p className="text-sm text-muted-foreground">Još nema nijednog tokena.</p>
        ) : (
          <ul className="divide-y">
            {tokens.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <span className="font-medium">{t.label}</span>
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{t.token_prefix}…</code>
                {t.revoked_at ? (
                  <Badge variant="secondary">Opozvan</Badge>
                ) : (
                  <Badge variant="outline">Aktivan</Badge>
                )}
                <span className="text-muted-foreground">
                  {t.last_used_at
                    ? `korišćen ${new Date(t.last_used_at).toLocaleString("sr-RS")}`
                    : "nikad korišćen"}
                </span>
                {!t.revoked_at ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto"
                    disabled={pending}
                    onClick={() => run(() => revokeBotToken(t.id))}
                  >
                    Opozovi
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function AccountMapping({ accounts, orphans }: { accounts: Account[]; orphans: string[] }) {
  const { pending, run } = useAction();
  const [draft, setDraft] = useState<Record<string, string>>({});

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Nalozi</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Poveži broj cTrader naloga sa nalogom u dnevniku. Bez toga bot ne zna gde da piše i
          njegovi događaji idu u karantin — nikad na „prvi nalog”.
        </p>

        {orphans.length > 0 ? (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            Bot javlja sa naloga koji nije mapiran:{" "}
            {orphans.map((o) => (
              <code key={o} className="mx-1 rounded bg-muted px-1.5 py-0.5 text-xs">
                {o}
              </code>
            ))}
          </div>
        ) : null}

        <ul className="divide-y">
          {accounts.map((a) => {
            const value = draft[a.id] ?? a.broker_account_id ?? "";
            const dirty = value !== (a.broker_account_id ?? "");
            return (
              <li key={a.id} className="flex flex-wrap items-center gap-3 py-2">
                <span className="min-w-32 text-sm font-medium">{a.name}</span>
                <Input
                  value={value}
                  onChange={(e) => setDraft({ ...draft, [a.id]: e.target.value })}
                  placeholder="broj cTrader naloga"
                  className="max-w-48"
                  disabled={pending}
                />
                {dirty ? (
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      run(() => setAccountBrokerId(a.id, value), () => {
                        const next = { ...draft };
                        delete next[a.id];
                        setDraft(next);
                      })
                    }
                  >
                    Sačuvaj
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function SymbolMapping({
  maps,
  instruments,
  unmapped,
}: {
  maps: BrokerSymbolMap[];
  instruments: string[];
  unmapped: ReturnType<typeof groupUnmappedSymbols>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Simboli i količina po lotu</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Količina po lotu je delilac kojim se cTrader-ov volumen pretvara u količinu u dnevniku.
          Potvrđuje se ručno jer „jedan lot” na index CFD-u definiše broker, a ne dnevnik —
          pogrešan delilac znači P&amp;L pogrešan za redove veličine.
        </p>

        {unmapped.map((u) => (
          <UnmappedSymbolRow key={`${u.broker}:${u.brokerSymbol}`} group={u} instruments={instruments} />
        ))}

        <NewSymbolMapForm instruments={instruments} />

        {maps.length === 0 ? (
          <p className="text-sm text-muted-foreground">Još nema nijednog mapiranja.</p>
        ) : (
          <ul className="divide-y">
            {maps.map((m) => (
              <SymbolMapRow key={m.id} map={m} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function SymbolMapRow({ map }: { map: BrokerSymbolMap }) {
  const { pending, run } = useAction();
  return (
    <li className="flex flex-wrap items-center gap-3 py-2 text-sm">
      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{map.broker_symbol}</code>
      <span className="text-muted-foreground">→</span>
      <span className="font-medium">{map.instrument}</span>
      <span className="text-muted-foreground">
        {map.units_per_qty.toLocaleString("sr-RS")} jedinica = 1
      </span>
      <Button
        size="sm"
        variant="ghost"
        className="ml-auto"
        disabled={pending}
        onClick={() => run(() => deleteBrokerSymbolMap(map.id))}
      >
        <Trash2 className="size-4" />
      </Button>
    </li>
  );
}

/**
 * A symbol the bot has actually sent, with the arithmetic on screen.
 *
 * The suggested instrument comes from `normalizeInstrumentSymbol` — the same
 * table CSV import uses — but only as a SUGGESTION. What gets stored is what
 * the human picks; the alias table is not a second answer to the mapping
 * question, it is a starting guess at it.
 */
function UnmappedSymbolRow({
  group,
  instruments,
}: {
  group: ReturnType<typeof groupUnmappedSymbols>[number];
  instruments: string[];
}) {
  const { pending, run } = useAction();
  const suggestion = normalizeInstrumentSymbol(group.brokerSymbol);
  const [instrument, setInstrument] = useState(
    suggestion && instruments.includes(suggestion) ? suggestion : "",
  );
  const [units, setUnits] = useState(
    group.proposal.lotSize != null ? String(group.proposal.lotSize) : "",
  );

  const p = group.proposal;

  return (
    <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <ShieldAlert className="size-4 text-amber-500" />
        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{group.brokerSymbol}</code>
        <span className="text-muted-foreground">
          nije mapiran — {group.count} {group.count === 1 ? "događaj" : "događaja"} u karantinu
        </span>
      </div>

      {p.volumeInUnits != null && p.lotSize != null ? (
        <p className="text-xs text-muted-foreground">
          cTrader javlja {p.volumeInUnits.toLocaleString("sr-RS")} jedinica, lot ={" "}
          {p.lotSize.toLocaleString("sr-RS")} → {p.impliedQty?.toLocaleString("sr-RS")} lot(ova).{" "}
          {p.agreesWithBroker ? (
            <span className="text-emerald-600 dark:text-emerald-400">
              Poklapa se sa cTrader-ovim brojem lotova.
            </span>
          ) : (
            <span className="text-amber-600 dark:text-amber-400">
              Ne poklapa se sa cTrader-ovim brojem ({p.quantity ?? "—"}) — proveri pre potvrde.
            </span>
          )}
        </p>
      ) : null}

      <div className="flex flex-wrap items-end gap-2">
        <Select value={instrument} onValueChange={setInstrument} disabled={pending}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Instrument" />
          </SelectTrigger>
          <SelectContent>
            {instruments.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={units}
          onChange={(e) => setUnits(e.target.value)}
          placeholder="jedinica po lotu"
          className="w-40"
          inputMode="decimal"
          disabled={pending}
        />
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            run(() =>
              upsertBrokerSymbolMap({
                brokerSymbol: group.brokerSymbol,
                instrument,
                unitsPerQty: Number(units),
                broker: group.broker,
              }),
            )
          }
        >
          Mapiraj
        </Button>
      </div>
    </div>
  );
}

function NewSymbolMapForm({ instruments }: { instruments: string[] }) {
  const { pending, run } = useAction();
  const [symbol, setSymbol] = useState("");
  const [instrument, setInstrument] = useState("");
  const [units, setUnits] = useState("");

  return (
    <div className="flex flex-wrap items-end gap-2">
      <Input
        value={symbol}
        onChange={(e) => setSymbol(e.target.value)}
        placeholder="simbol kod brokera"
        className="w-40"
        disabled={pending}
      />
      <Select value={instrument} onValueChange={setInstrument} disabled={pending}>
        <SelectTrigger className="w-44">
          <SelectValue placeholder="Instrument" />
        </SelectTrigger>
        <SelectContent>
          {instruments.map((s) => (
            <SelectItem key={s} value={s}>
              {s}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        value={units}
        onChange={(e) => setUnits(e.target.value)}
        placeholder="jedinica po lotu"
        className="w-40"
        inputMode="decimal"
        disabled={pending}
      />
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() =>
          run(
            () =>
              upsertBrokerSymbolMap({
                brokerSymbol: symbol,
                instrument,
                unitsPerQty: Number(units),
              }),
            () => {
              setSymbol("");
              setInstrument("");
              setUnits("");
            },
          )
        }
      >
        <Plus className="size-4" />
        Dodaj
      </Button>
      {symbol && cleanBrokerSymbol(symbol) !== symbol ? (
        <span className="text-xs text-muted-foreground">
          čuva se kao <code>{cleanBrokerSymbol(symbol)}</code>
        </span>
      ) : null}
    </div>
  );
}

function QuarantineList({ rows, total }: { rows: BotEventRow[]; total: number | null }) {
  const { pending, run } = useAction();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Karantin{" "}
          {total != null ? (
            <span className="text-sm font-normal text-muted-foreground">({total})</span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Događaji koje bot je poslao a dnevnik nije mogao da razreši. Nijedan od njih nije upisan
          kao trejd — radije ništa nego pogođen broj.
        </p>

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Karantin je prazan.</p>
        ) : (
          <>
            {total != null && total > rows.length ? (
              <p className="text-xs text-muted-foreground">
                Prikazano najnovijih {rows.length} od {total}.
              </p>
            ) : null}
            <ul className="divide-y text-sm">
              {rows.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="text-muted-foreground">
                    {new Date(r.received_at).toLocaleString("sr-RS")}
                  </span>
                  <Badge variant="outline">{r.kind}</Badge>
                  <span>{quarantineReasonLabel(r.reason)}</span>
                </li>
              ))}
            </ul>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => run(() => clearQuarantinedEvents(rows.map((r) => r.id)))}
            >
              <Trash2 className="size-4" />
              Očisti prikazane
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
