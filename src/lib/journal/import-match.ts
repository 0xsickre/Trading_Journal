/**
 * Koji već postojeći trejd je red iz izvoda.
 *
 * Ovo je bilo zakopano u petlji unutar `import-wizard.tsx` — 572 linija
 * komponente sa jednim render testom, pa odluka od koje zavisi da li se trejd
 * PREPISUJE nije imala nijedan test. A spajanje nije bezopasna operacija:
 * `commitImport` na merge poziva `tj_replace_executions`, što briše postojeće
 * fill-ove i upisuje one iz izvoda. Spojiti se sa pogrešnim trejdom znači
 * uništiti njegove fill-ove i pokvariti tuđe.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NAĐENO: DVOSMISLENOST JE POSTOJALA U TIPU, ALI NE U KODU
 *
 * `ImportItem.match_status` od početka nabraja `"ambiguous"`. Nijedno mesto u
 * projektu tu vrednost nije proizvodilo. Petlja je radila `break` na PRVOM
 * kandidatu koji prođe, a kandidati stižu poređani po `created_at DESC` —
 * dakle po tome koji je trejd poslednji UNET, što sa pitanjem „koji je ovo
 * trejd" nema veze.
 *
 * Prozor spajanja je 10 minuta i cena unutar `max(0.05 %, 0.01)`. Za ES na
 * 5000 to je 2,5 poena; za EURUSD na 1.0850 oko 5 pipsa. Skalper koji uđe u ES
 * na 5000.00 pa opet na 5001.50 šest minuta kasnije ima DVA trejda koja oba
 * prolaze isti filter — i stari kod bi drugi red izvoda spojio sa prvim
 * trejdom, tiho.
 *
 * Rešenje NIJE stezanje praga. Svaki prag koji bih izabrao bio bi izmišljen, a
 * uz to bi promašaj u drugom smeru (ne prepozna svoj trejd) samo napravio
 * duplikat. Rešenje je da se dvosmislenost VIDI: kad prolazi više od jednog
 * kandidata, red se označava kao `ambiguous` i podrazumevano se KREIRA.
 *
 * Asimetrija je namerna i vredi je zapisati. Pogrešno kreiranje daje višak
 * trejda koji se briše u jednom potezu. Pogrešno spajanje briše fill-ove
 * trejda koji je bio tačan, i taj gubitak se ne vidi dok se ne potraži.
 */

export type MatchCandidate = {
  id: string;
  instrument: string | null;
  direction: string | null;
  avgEntry: number | null;
  avgExit: number | null;
  openedAt: string | null;
  totalFees: number | null;
  totalSwap: number | null;
  grossPl: number | null;
  netPl: number | null;
};

/**
 * Koliko sme da se razlikuje vreme ulaza da bi to bio isti trejd.
 *
 * Deset minuta pokriva razliku između vremena koje je trejder zapisao rukom i
 * vremena izvršenja sa izvoda. Uže bi promašilo ručne unose zaokružene na pun
 * sat; šire bi počelo da hvata sledeći trejd u istoj seansi.
 */
export const MERGE_TIME_WINDOW_MS = 10 * 60 * 1000;

/**
 * Koliko sme da se razlikuje cena ulaza.
 *
 * Relativno, jer apsolutna tolerancija ne može da važi i za EURUSD na 1.08 i za
 * ES na 5000. Donja granica od 0,01 postoji zbog instrumenata čija je cena
 * mala: 0,05 % od 1.0850 je 0.00054, a proklizavanje od jednog pipsa je
 * uobičajeno i ne znači drugi trejd.
 */
export function mergePriceTolerance(price: number): number {
  return Math.max(0.0005 * Math.abs(price), 0.01);
}

export type ImportRowKey = {
  instrument: string | null;
  direction: string | null;
  entryPrice: number | null;
  /** UTC ISO, ili null kad vreme nije pročitano. */
  entryTime: string | null;
};

export type MatchOutcome = {
  /** Kandidat sa kojim se spaja, ili null kad se kreira. */
  matched: MatchCandidate | null;
  status: "new" | "match" | "ambiguous";
  /** Svi kandidati koji su prošli filter — više od jednog je `ambiguous`. */
  candidates: MatchCandidate[];
};

/**
 * Da li kandidat i red izvoda mogu biti isti trejd.
 *
 * Oba uslova, bez izuzetka. Vreme bez cene bi spojilo dva trejda otvorena u
 * istom minutu na istom instrumentu; cena bez vremena bi spojila isti nivo
 * trgovan u ponedeljak i u petak.
 */
function sameTrade(
  c: MatchCandidate,
  row: ImportRowKey,
  instrumentsMatch: (a: string, b: string) => boolean,
): boolean {
  if (!c.instrument || !row.instrument) return false;
  if (!instrumentsMatch(c.instrument, row.instrument)) return false;
  if ((c.direction ?? "").toLowerCase() !== (row.direction ?? "").toLowerCase()) {
    return false;
  }
  if (row.entryTime == null || c.openedAt == null) return false;
  if (row.entryPrice == null || c.avgEntry == null) return false;

  const rowMs = new Date(row.entryTime).getTime();
  const candMs = new Date(c.openedAt).getTime();
  if (!Number.isFinite(rowMs) || !Number.isFinite(candMs)) return false;
  if (Math.abs(candMs - rowMs) >= MERGE_TIME_WINDOW_MS) return false;

  return (
    Math.abs(c.avgEntry - row.entryPrice) <= mergePriceTolerance(row.entryPrice)
  );
}

/**
 * Nađi trejd sa kojim se red spaja.
 *
 * `instrumentsMatch` se prosleđuje umesto da se uvozi, da bi modul ostao čist i
 * testabilan sa izmišljenim pravilom poklapanja simbola — pravi
 * `instrument-aliases` ima sopstveni test.
 */
export function matchImportRow(
  row: ImportRowKey,
  candidates: readonly MatchCandidate[],
  instrumentsMatch: (a: string, b: string) => boolean,
): MatchOutcome {
  const hits = candidates.filter((c) => sameTrade(c, row, instrumentsMatch));

  if (hits.length === 0) return { matched: null, status: "new", candidates: [] };
  if (hits.length === 1) {
    return { matched: hits[0], status: "match", candidates: hits };
  }
  // Više od jednog. NE bira se „najbliži": bliža cena ne znači da je to taj
  // trejd, a merge koji promaši briše fill-ove. Red se kreira, a oznaka kaže
  // čoveku da pogleda.
  return { matched: null, status: "ambiguous", candidates: hits };
}
