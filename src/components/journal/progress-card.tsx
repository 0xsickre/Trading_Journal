import { TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { fmtMoney } from "@/lib/journal/format";
import type { ProgressRow, ProgressSummary } from "@/lib/journal/progress";

const r = (x: number | null) => (x == null ? "—" : `${x >= 0 ? "+" : ""}${x.toFixed(2)} R`);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const tone = (x: number | null) => (x == null ? "" : x > 0 ? "text-[var(--profit)]" : x < 0 ? "text-[var(--loss)]" : "");

function Rows({
  title,
  hint,
  rows,
  prev,
  currency,
  first = "",
}: {
  title: string;
  hint: string;
  rows: ProgressRow[];
  prev: ProgressRow[];
  currency: string;
  first?: string;
}) {
  if (rows.length === 0) return null;
  const before = new Map(prev.map((p) => [p.key, p]));
  return (
    <div className="space-y-1">
      <div className="text-sm font-medium">{title}</div>
      <div className="text-xs text-muted-foreground">{hint}</div>
      <table className="w-full text-xs">
        <thead className="text-muted-foreground">
          <tr>
            <th className="py-1 text-left font-normal">{first}</th>
            <th className="text-right font-normal">trejdova</th>
            <th className="text-right font-normal">neto</th>
            <th className="text-right font-normal">prosek R</th>
            <th className="text-right font-normal">dobitnih</th>
            <th className="text-right font-normal">prošle ned. R</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.key} className="border-t">
              <td className="py-1">{x.label}</td>
              <td className="text-right">{x.n}</td>
              <td className={cn("text-right", tone(x.net))}>{fmtMoney(x.net, currency, { sign: true })}</td>
              <td className={cn("text-right", tone(x.avgR))}>{r(x.avgR)}</td>
              <td className="text-right">{pct(x.winRate)}</td>
              <td className="text-right text-muted-foreground">{r(before.get(x.key)?.avgR ?? null)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The six answers of the week, beside last week's — the one screen a day trader
 * reads on the weekend (`progress.ts`). Everything but setup, grade and mistake
 * is off the fills and the R2 prices.
 */
export function ProgressCard({
  week,
  prev,
  currency,
}: {
  week: ProgressSummary;
  prev: ProgressSummary;
  currency: string;
}) {
  const t = week.total;
  const p = prev.total;
  const e = week.excursion;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="size-4" /> Napredak
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {t.n === 0 ? (
          <p className="text-sm text-muted-foreground">Nema zatvorenih trejdova ove nedelje.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              {(
                [
                  ["Trejdova", String(t.n), String(p.n)],
                  ["Neto", fmtMoney(t.net, currency, { sign: true }), fmtMoney(p.net, currency, { sign: true })],
                  ["Prosek R", r(t.avgR), r(p.avgR)],
                  ["Dobitnih", pct(t.winRate), p.n ? pct(p.winRate) : "—"],
                ] as const
              ).map(([label, now, before]) => (
                <div key={label} className="rounded-md border p-2">
                  <div className="text-xs text-muted-foreground">{label}</div>
                  <div className="font-semibold">{now}</div>
                  <div className="text-xs text-muted-foreground">prošle ned. {before}</div>
                </div>
              ))}
            </div>
            {t.n < 20 && (
              <p className="text-xs text-muted-foreground">
                {t.n} trejdova je mali uzorak — gledaj smer i ponavljanje iz nedelje u nedelju, ne tačan broj.
              </p>
            )}

            <Rows
              title="1. Setup"
              hint="Koji setup donosi R. Setup koji nedeljama stoji ispod 0 R je kandidat za izbacivanje."
              first="setup"
              rows={week.setups}
              prev={prev.setups}
              currency={currency}
            />
            <Rows
              title="2. Cena grešaka"
              hint="Najskuplja greška je pravilo za sledeću nedelju — jedno, ne pet."
              first="greška"
              rows={week.mistakes}
              prev={prev.mistakes}
              currency={currency}
            />
            <Rows
              title="3. Po planu"
              hint="A prema B/C: koliko vredi disciplina. Ako su B/C u minusu a A u plusu, problem nije strategija."
              rows={week.grades}
              prev={prev.grades}
              currency={currency}
            />
            <Rows
              title="4. Sat ulaza"
              hint="Kad ti ide, a kad bolje ne trgovati."
              first="sat"
              rows={week.hours}
              prev={prev.hours}
              currency={currency}
            />

            <div className="space-y-1">
              <div className="text-sm font-medium">5. Stop i izlaz (MAE/MFE)</div>
              <div className="text-xs text-muted-foreground">
                Iz R2 cena, {e.n} trejdova sa merenjem. Dobitnici koji idu blizu −1 R traže širi stop ili bolji ulaz; gubitnici
                koji su bili +1 R u plusu traže plan za zaštitu dobiti; mala iskorišćenost znači prerani izlaz.
              </div>
              <div className="grid grid-cols-3 gap-3 text-sm">
                {(
                  [
                    ["Dobitnici išli protiv (MAE)", e.winnersMaeR == null ? "—" : `−${e.winnersMaeR.toFixed(2)} R`, prev.excursion.winnersMaeR],
                    ["Gubitnici bili u plusu (MFE)", e.losersMfeR == null ? "—" : `+${e.losersMfeR.toFixed(2)} R`, prev.excursion.losersMfeR],
                    ["Iskorišćen potez", e.capture == null ? "—" : `${Math.round(e.capture)}%`, null],
                  ] as const
                ).map(([label, now, before]) => (
                  <div key={label} className="rounded-md border p-2">
                    <div className="text-xs text-muted-foreground">{label}</div>
                    <div className="font-semibold">{now}</div>
                    {before != null && <div className="text-xs text-muted-foreground">prošle ned. {before.toFixed(2)} R</div>}
                  </div>
                ))}
              </div>
            </div>

            <Rows
              title="6. Redosled u danu"
              hint="Ako drugi i treći trejd, ili trejd posle gubitka, stalno gube — to je tvoj dnevni limit."
              rows={[...week.order, ...(week.afterLoss ? [week.afterLoss] : [])]}
              prev={[...prev.order, ...(prev.afterLoss ? [prev.afterLoss] : [])]}
              currency={currency}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
