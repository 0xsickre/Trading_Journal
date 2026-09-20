"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Instrument } from "@/lib/journal/types";
import { parseSettingsNumber } from "@/lib/journal/settings-rules";
import {
  addInstrument,
  countInstrumentUsage,
  updateInstrument,
  deleteInstrument,
} from "@/app/(app)/settings/actions";

// Every instrument action revalidates /settings itself, so no router.refresh().

/**
 * The two contract numbers, read the way a trader types them, or the reason
 * they cannot be. `Number()` turned "1,5" into NaN and then into the default 1
 * without a word, so a CFD saved with the wrong point value.
 */
function readSpec(
  pointValue: string,
  tickSize: string,
): { ok: true; point_value: number; tick_size: number | null } | { ok: false; error: string } {
  const pv = parseSettingsNumber(pointValue, { min: 0 });
  if (!pv.ok) return { ok: false, error: `Point value: ${pv.error}` };
  if (pv.value === 0) return { ok: false, error: "Point value: Must be greater than zero." };
  const ts = parseSettingsNumber(tickSize, { min: 0, allowEmpty: true });
  if (!ts.ok) return { ok: false, error: `Tick: ${ts.error}` };
  return { ok: true, point_value: pv.value!, tick_size: ts.value };
}

const CURRENCY_RE = /^[A-Za-z]{3}$/;

/** The four cost fields, or the first reason one of them cannot be read. */
function readCosts(input: {
  commLot: string;
  commPct: string;
  swapLong: string;
  swapShort: string;
}):
  | {
      ok: true;
      commission_per_lot: number;
      commission_pct: number;
      swap_long: number;
      swap_short: number;
    }
  | { ok: false; error: string } {
  const perLot = parseSettingsNumber(input.commLot, { min: 0 });
  if (!perLot.ok) return { ok: false, error: `Commission per lot: ${perLot.error}` };
  const pct = parseSettingsNumber(input.commPct, { min: 0, max: 100 });
  if (!pct.ok) return { ok: false, error: `Commission %: ${pct.error}` };
  // Swap is signed: a positive number is a credit the broker pays you.
  const long = parseSettingsNumber(input.swapLong);
  if (!long.ok) return { ok: false, error: `Swap long: ${long.error}` };
  const short = parseSettingsNumber(input.swapShort);
  if (!short.ok) return { ok: false, error: `Swap short: ${short.error}` };
  return {
    ok: true,
    commission_per_lot: perLot.value ?? 0,
    commission_pct: pct.value ?? 0,
    swap_long: long.value ?? 0,
    swap_short: short.value ?? 0,
  };
}

function DeleteInstrumentDialog({
  inst,
  open,
  onOpenChange,
  trades,
}: {
  inst: Instrument;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Trades on the symbol: null while counting, -1 when the count failed. */
  trades: number | null;
}) {
  const [pending, start] = useTransition();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {inst.symbol}?</DialogTitle>
          <DialogDescription>
            {trades == null
              ? "Checking which trades use it…"
              : trades < 0
                ? "Could not count the trades that use it."
                : trades === 0
                  ? "No trade uses it."
                  : `${trades} ${trades === 1 ? "trade uses" : "trades use"} it. ${trades === 1 ? "It keeps" : "They keep"} the symbol, but new trades on it lose the contract spec.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={pending || trades == null}
            onClick={() =>
              start(async () => {
                const res = await deleteInstrument(inst.id);
                if (!res.ok) toast.error(res.error);
                else {
                  toast.success(`Deleted ${inst.symbol}`);
                  onOpenChange(false);
                }
              })
            }
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InstrumentRow({ inst }: { inst: Instrument }) {
  const [pending, start] = useTransition();
  const id = useId();
  const [pointValue, setPointValue] = useState(String(inst.point_value));
  const [tickSize, setTickSize] = useState(inst.tick_size == null ? "" : String(inst.tick_size));
  const [commLot, setCommLot] = useState(String(inst.commission_per_lot));
  const [commPct, setCommPct] = useState(String(inst.commission_pct));
  const [swapLong, setSwapLong] = useState(String(inst.swap_long));
  const [swapShort, setSwapShort] = useState(String(inst.swap_short));
  const [deleting, setDeleting] = useState(false);
  const [trades, setTrades] = useState<number | null>(null);
  const [, startCount] = useTransition();

  function openDelete() {
    // Re-counted on every opening, so a count from an earlier one is never shown.
    setTrades(null);
    setDeleting(true);
    startCount(async () => {
      const res = await countInstrumentUsage(inst.id);
      setTrades(res.ok ? res.trades : -1);
    });
  }

  const spec = readSpec(pointValue, tickSize);
  // The four cost fields, read the way every other number on this page is read:
  // "2,5" is two and a half, and a value that cannot be read blocks the save
  // rather than silently becoming zero.
  const costs = readCosts({ commLot, commPct, swapLong, swapShort });
  const ok = spec.ok && costs.ok;
  const changed =
    ok &&
    (spec.point_value !== inst.point_value ||
      spec.tick_size !== inst.tick_size ||
      costs.commission_per_lot !== inst.commission_per_lot ||
      costs.commission_pct !== inst.commission_pct ||
      costs.swap_long !== inst.swap_long ||
      costs.swap_short !== inst.swap_short);

  function save() {
    // Name and class come from the catalog, and editing them solves no problem
    // the user has. The contract spec and what the broker charges do: both
    // differ per broker, and both multiply every trade on the symbol.
    if (!spec.ok) {
      toast.error(spec.error);
      return;
    }
    if (!costs.ok) {
      toast.error(costs.error);
      return;
    }
    start(async () => {
      const res = await updateInstrument(inst.id, {
        point_value: spec.point_value,
        tick_size: spec.tick_size,
        commission_per_lot: costs.commission_per_lot,
        commission_pct: costs.commission_pct,
        swap_long: costs.swap_long,
        swap_short: costs.swap_short,
      });
      if (!res.ok) toast.error(res.error);
      else toast.success(`Saved ${inst.symbol}`);
    });
  }

  return (
    <div className="grid grid-cols-12 items-end gap-2 rounded-md border p-2">
      <div className="col-span-12 sm:col-span-5">
        <div className="font-mono text-sm font-semibold">{inst.symbol}</div>
        <div className="text-[11px] text-muted-foreground">
          {inst.name ? `${inst.name} · ` : ""}
          {inst.asset_class ?? "—"} · {inst.quote_currency}
        </div>
      </div>
      <div className="col-span-4 sm:col-span-2">
        <Label htmlFor={`${id}-pv`} className="text-[11px] text-muted-foreground">
          {inst.quote_currency} / point
        </Label>
        <Input
          id={`${id}-pv`}
          className="h-8"
          inputMode="decimal"
          value={pointValue}
          aria-invalid={!spec.ok}
          onChange={(e) => setPointValue(e.target.value)}
        />
      </div>
      <div className="col-span-4 sm:col-span-2">
        <Label htmlFor={`${id}-tick`} className="text-[11px] text-muted-foreground">
          Tick
        </Label>
        <Input
          id={`${id}-tick`}
          className="h-8"
          inputMode="decimal"
          value={tickSize}
          aria-invalid={!spec.ok}
          onChange={(e) => setTickSize(e.target.value)}
        />
      </div>
      <div className="col-span-6 sm:col-span-2">
        <Label htmlFor={`${id}-comm`} className="text-[11px] text-muted-foreground">
          {inst.commission_pct > 0 ? "% of notional" : `${inst.commission_currency} / lot`}
        </Label>
        <Input
          id={`${id}-comm`}
          className="h-8"
          inputMode="decimal"
          value={inst.commission_pct > 0 ? commPct : commLot}
          aria-invalid={!costs.ok}
          onChange={(e) =>
            inst.commission_pct > 0 ? setCommPct(e.target.value) : setCommLot(e.target.value)
          }
        />
      </div>
      <div className="col-span-3 sm:col-span-1">
        <Label htmlFor={`${id}-swl`} className="text-[11px] text-muted-foreground">
          Swap L
        </Label>
        <Input
          id={`${id}-swl`}
          className="h-8"
          inputMode="decimal"
          value={swapLong}
          aria-invalid={!costs.ok}
          onChange={(e) => setSwapLong(e.target.value)}
        />
      </div>
      <div className="col-span-3 sm:col-span-1">
        <Label htmlFor={`${id}-sws`} className="text-[11px] text-muted-foreground">
          Swap S
        </Label>
        <Input
          id={`${id}-sws`}
          className="h-8"
          inputMode="decimal"
          value={swapShort}
          aria-invalid={!costs.ok}
          onChange={(e) => setSwapShort(e.target.value)}
        />
      </div>
      <div className="col-span-12 flex gap-1 sm:col-span-3">
        <Button size="sm" className="h-8 flex-1" disabled={pending || !changed} onClick={save}>
          Save
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          disabled={pending}
          onClick={openDelete}
          aria-label={`Delete ${inst.symbol}`}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
      {!spec.ok && <p className="col-span-12 text-xs text-destructive">{spec.error}</p>}
      {spec.ok && !costs.ok && (
        <p className="col-span-12 text-xs text-destructive">{costs.error}</p>
      )}
      <p className="col-span-12 text-[11px] text-muted-foreground">
        Commission is charged per side, so a round turn costs twice this. Swap is in points per
        lot per night, charged three times on{" "}
        {inst.swap_triple_day === 5 ? "Friday" : "Wednesday"}.
      </p>
      <DeleteInstrumentDialog
        inst={inst}
        open={deleting}
        onOpenChange={setDeleting}
        trades={trades}
      />
    </div>
  );
}

export function InstrumentManager({ instruments }: { instruments: Instrument[] }) {
  const [pending, start] = useTransition();
  const id = useId();
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [assetClass, setAssetClass] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [pointValue, setPointValue] = useState("1");
  const [tickSize, setTickSize] = useState("");
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return instruments;
    return instruments.filter((i) =>
      [i.symbol, i.name ?? "", i.asset_class ?? ""].some((v) => v.toLowerCase().includes(q)),
    );
  }, [instruments, query]);

  const currencyOk = CURRENCY_RE.test(currency.trim());

  function add() {
    if (!symbol.trim()) return;
    const spec = readSpec(pointValue, tickSize);
    if (!spec.ok) {
      toast.error(spec.error);
      return;
    }
    if (!currencyOk) {
      toast.error("Currency is a three-letter code, like USD.");
      return;
    }
    start(async () => {
      const res = await addInstrument({
        symbol,
        name,
        asset_class: assetClass,
        quote_currency: currency.trim().toUpperCase(),
        point_value: spec.point_value,
        tick_size: spec.tick_size,
      });
      if (!res.ok) toast.error(res.error);
      else {
        setSymbol("");
        setName("");
        setAssetClass("");
        setCurrency("USD");
        setPointValue("1");
        setTickSize("");
        toast.success("Instrument added");
      }
    });
  }

  const field = (suffix: string) => `${id}-${suffix}`;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        The catalog is ready to use. Add a missing symbol, or correct the point value
        and tick when your broker&apos;s contract differs.
      </p>

      <Card>
        <CardContent className="grid grid-cols-12 items-end gap-2 pt-6">
          <div className="col-span-6 sm:col-span-2">
            <Label htmlFor={field("symbol")} className="text-[11px] text-muted-foreground">
              Symbol
            </Label>
            <Input
              id={field("symbol")}
              className="h-8"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="MGC"
            />
          </div>
          <div className="col-span-6 sm:col-span-3">
            <Label htmlFor={field("name")} className="text-[11px] text-muted-foreground">
              Name
            </Label>
            <Input
              id={field("name")}
              className="h-8"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="col-span-4 sm:col-span-2">
            <Label htmlFor={field("class")} className="text-[11px] text-muted-foreground">
              Asset class
            </Label>
            <Input
              id={field("class")}
              className="h-8"
              value={assetClass}
              onChange={(e) => setAssetClass(e.target.value)}
              placeholder="Futures"
            />
          </div>
          <div className="col-span-4 sm:col-span-1">
            <Label htmlFor={field("ccy")} className="text-[11px] text-muted-foreground">
              Currency
            </Label>
            <Input
              id={field("ccy")}
              className="h-8 uppercase"
              value={currency}
              maxLength={3}
              aria-invalid={!currencyOk}
              onChange={(e) => setCurrency(e.target.value)}
            />
          </div>
          <div className="col-span-4 sm:col-span-2">
            <Label htmlFor={field("pv")} className="text-[11px] text-muted-foreground">
              {currencyOk ? currency.trim().toUpperCase() : "Currency"} / point
            </Label>
            <Input
              id={field("pv")}
              className="h-8"
              inputMode="decimal"
              value={pointValue}
              onChange={(e) => setPointValue(e.target.value)}
            />
          </div>
          <div className="col-span-6 sm:col-span-1">
            <Label htmlFor={field("tick")} className="text-[11px] text-muted-foreground">
              Tick
            </Label>
            <Input
              id={field("tick")}
              className="h-8"
              inputMode="decimal"
              value={tickSize}
              onChange={(e) => setTickSize(e.target.value)}
            />
          </div>
          <div className="col-span-6 sm:col-span-1">
            <Button className="h-8 w-full" disabled={pending || !symbol.trim()} onClick={add}>
              <Plus className="size-4" /> Add
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="relative">
        <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search instruments"
          aria-label="Search instruments"
          className="h-9 pl-8"
        />
      </div>

      <div className="space-y-2">
        {shown.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No instruments match.</p>
        ) : (
          shown.map((inst) => <InstrumentRow key={inst.id} inst={inst} />)
        )}
      </div>
    </div>
  );
}
