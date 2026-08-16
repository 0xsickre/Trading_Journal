"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import type { Instrument } from "@/lib/journal/types";
import {
  addInstrument,
  updateInstrument,
  deleteInstrument,
} from "@/app/(app)/settings/actions";

function num(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function InstrumentRow({ inst }: { inst: Instrument }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [pointValue, setPointValue] = useState(String(inst.point_value));
  const [tickSize, setTickSize] = useState(
    inst.tick_size == null ? "" : String(inst.tick_size),
  );

  function save() {
    start(async () => {
      // Šalju se samo dva polja. Ime i klasa dolaze iz kataloga i menjati ih
      // ne rešava nijedan problem koji korisnik ima; `$ / point` i `tick` rešavaju
      // onaj jedan koji ima — broker čija se specifikacija razlikuje od
      // podrazumevane.
      const res = await updateInstrument(inst.id, {
        point_value: num(pointValue) ?? 1,
        tick_size: num(tickSize),
      });
      if (!res.ok) toast.error(res.error);
      else {
        toast.success(`Saved ${inst.symbol}`);
        router.refresh();
      }
    });
  }

  function remove() {
    start(async () => {
      const res = await deleteInstrument(inst.id);
      if (!res.ok) toast.error(res.error);
      else router.refresh();
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
        <Label className="text-[11px] text-muted-foreground">$ / point</Label>
        <Input
          className="h-8"
          inputMode="decimal"
          value={pointValue}
          onChange={(e) => setPointValue(e.target.value)}
        />
      </div>
      <div className="col-span-4 sm:col-span-2">
        <Label className="text-[11px] text-muted-foreground">Tick</Label>
        <Input
          className="h-8"
          inputMode="decimal"
          value={tickSize}
          onChange={(e) => setTickSize(e.target.value)}
        />
      </div>
      <div className="col-span-4 flex gap-1 sm:col-span-3">
        <Button
          size="sm"
          className="h-8 flex-1"
          disabled={pending}
          onClick={save}
        >
          <Save className="size-4" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          disabled={pending}
          onClick={remove}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export function InstrumentManager({
  instruments,
}: {
  instruments: Instrument[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [assetClass, setAssetClass] = useState("");
  const [pointValue, setPointValue] = useState("1");
  const [tickSize, setTickSize] = useState("");

  function add() {
    if (!symbol.trim()) {
      toast.error("Symbol required");
      return;
    }
    start(async () => {
      const res = await addInstrument({
        symbol,
        name,
        asset_class: assetClass,
        point_value: num(pointValue) ?? 1,
        tick_size: num(tickSize),
      });
      if (!res.ok) toast.error(res.error);
      else {
        setSymbol("");
        setName("");
        setAssetClass("");
        setPointValue("1");
        setTickSize("");
        toast.success("Instrument added");
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid grid-cols-12 items-end gap-2 pt-6">
          <div className="col-span-6 sm:col-span-2">
            <Label className="text-[11px] text-muted-foreground">Symbol *</Label>
            <Input
              className="h-8"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="MGC"
            />
          </div>
          <div className="col-span-6 sm:col-span-3">
            <Label className="text-[11px] text-muted-foreground">Name</Label>
            <Input
              className="h-8"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="col-span-6 sm:col-span-2">
            <Label className="text-[11px] text-muted-foreground">
              Asset class
            </Label>
            <Input
              className="h-8"
              value={assetClass}
              onChange={(e) => setAssetClass(e.target.value)}
              placeholder="Futures"
            />
          </div>
          <div className="col-span-3 sm:col-span-2">
            <Label className="text-[11px] text-muted-foreground">$ / point</Label>
            <Input
              className="h-8"
              inputMode="decimal"
              value={pointValue}
              onChange={(e) => setPointValue(e.target.value)}
            />
          </div>
          <div className="col-span-3 sm:col-span-1">
            <Label className="text-[11px] text-muted-foreground">Tick</Label>
            <Input
              className="h-8"
              inputMode="decimal"
              value={tickSize}
              onChange={(e) => setTickSize(e.target.value)}
            />
          </div>
          <div className="col-span-6 sm:col-span-2">
            <Button className="h-8 w-full" disabled={pending} onClick={add}>
              <Plus className="size-4" /> Add
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {instruments.map((inst) => (
          <InstrumentRow key={inst.id} inst={inst} />
        ))}
      </div>
    </div>
  );
}
