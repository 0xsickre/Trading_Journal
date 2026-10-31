import Link from "next/link";
import { format, parseISO } from "date-fns";
import { srLatn } from "date-fns/locale/sr-Latn";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prevReportDate } from "@/lib/journal/daily-report";
import { DATE } from "@/lib/journal/time";

/**
 * What `/daily` shows on a Saturday or a Sunday: CME does not trade, so the day
 * asks for nothing (trader, 31.10.2026). The way back to Friday is here because
 * the CME day turns over at 17:00 Chicago, so Friday's close is often written
 * once the page has already moved on to Saturday.
 */
export function WeekendDay({ day }: { day: string }) {
  const friday = prevReportDate(day);
  const label = (d: string) => format(parseISO(d), `EEE, ${DATE}`, { locale: srLatn });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Vikend: {label(day)}</CardTitle>
        <p className="text-sm text-muted-foreground">
          CME ne trguje, pa nema dnevne prijave ni pravila za ovaj dan.
        </p>
      </CardHeader>
      <CardContent>
        <Button variant="outline" size="sm" asChild>
          <Link href={`/daily?date=${friday}`}>Poslednji trgovački dan: {label(friday)}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
