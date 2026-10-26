import Link from "next/link";
import { fmtMoney, fmtR, pnlClass } from "@/lib/journal/format";
import type { DayClose, DayCloseTrade } from "@/lib/journal/day-close";
import { cn } from "@/lib/utils";

function TradeLine({ title, t, currency }: { title: string; t: DayCloseTrade; currency: string }) {
  return (
    <p className="text-sm">
      <span className="text-muted-foreground">{title}: </span>
      <Link href={`/trades/${t.id}?from=daily`} className="underline underline-offset-2 hover:no-underline">
        {t.label}
      </Link>{" "}
      <span className={cn("tabular-nums", pnlClass(t.net))}>{fmtMoney(t.net, currency, { sign: true })}</span>
      {t.r != null && <span className="tabular-nums text-muted-foreground"> · {fmtR(t.r)}</span>}
      {" · "}
      {t.hasChart ? (
        <span className="text-muted-foreground">slika ✓</span>
      ) : (
        <span className="text-[var(--loss)]">fali slika</span>
      )}
    </p>
  );
}

/**
 * What the day brought (phase B7): its best and worst trade, the two that must
 * carry a chart, and every mistake with what it cost — the trader's own and the
 * journal's ("auto") together.
 */
export function DayCloseCard({ close, currency }: { close: DayClose; currency: string }) {
  if (close.closed === 0) {
    return <p className="text-sm text-muted-foreground">Nema zatvorenih trejdova ovog dana.</p>;
  }
  const sameTrade = close.best?.id === close.worst?.id;
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        {close.best && <TradeLine title={sameTrade ? "Jedini trejd" : "Najbolji"} t={close.best} currency={currency} />}
        {close.worst && !sameTrade && <TradeLine title="Najgori" t={close.worst} currency={currency} />}
      </div>
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">Greške dana i šta su koštale</p>
        {close.mistakes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nijedna — ni ručna ni automatska.</p>
        ) : (
          <ul className="space-y-0.5 text-sm">
            {close.mistakes.map((m) => (
              <li key={m.tag} className="flex flex-wrap items-baseline gap-x-2">
                <span>{m.tag}</span>
                {m.auto && (
                  <span className="rounded border px-1 text-[10px] uppercase tracking-wide text-muted-foreground">auto</span>
                )}
                <span className="text-xs text-muted-foreground">
                  {m.trades} {m.trades === 1 ? "trejd" : "trejda"} ·{" "}
                  <span className={cn("tabular-nums", pnlClass(m.net))}>{fmtMoney(m.net, currency, { sign: true })}</span>
                  {m.r != null && <span className="tabular-nums"> · {fmtR(m.r)}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
