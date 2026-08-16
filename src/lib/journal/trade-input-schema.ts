/**
 * Opseg vrednosti na putu upisa trejda.
 *
 * `buildPositionPatch` je do sada bila jedina odbrana, i ona proverava IMENA
 * kolona i tip — ne opseg. Broj koji je konačan prolazi, pa je i −5000 prolazio.
 *
 * Izmereno na živoj bazi pre ove izmene: ES, ulaz −5000, izlaz −4990,
 * `point_value` 50 → view ispisuje `gross_pl = 500`, `net_pl = 500`,
 * `realized_r = 1.00`. Ništa ne pada i ništa se ne označava — trejd izgleda kao
 * običan dobitak od 500 $. To je najgori mogući ishod za journal: ne greška,
 * nego SIGURAN pogrešan broj koji ulazi u profit factor, expectancy i Sickre
 * Score kao da je zarađen.
 *
 * Zašto ovde, a ne samo CHECK u bazi: CHECK je i dodat (`20260816...`), i on je
 * taj koji zaustavlja i direktan PostgREST upis. Ova kopija postoji da bi
 * korisnik dobio rečenicu umesto teksta „violates check constraint
 * tj_positions_prices_positive". Isti dogovor koji `weekly/actions.ts` već
 * primenjuje na ponedeljak.
 *
 * ODLUKA KOJU VREDI ZNATI: cena mora biti > 0. Postoji stvaran izuzetak —
 * WTI je 20.04.2020. namiren na −37,63 $. To je bila cena namirenja fjučersa u
 * jednom danu u istoriji, a ne popunjenje koje retail nalog vidi. Naspram toga
 * stoji svaki omašen znak, svaki „−" zalepljen iz izvoda i svaki minus otkucan
 * u polju cene. Odbijanje sa jasnom porukom je bolje od tihog prihvatanja, i
 * ako ikad zatreba, ovo je jedno mesto na kojem se pravilo menja.
 */

import { z } from "zod";
import { TRADE_IMAGE_KINDS } from "./tradingview-snapshot";

/**
 * Kolone `tj_positions` koje nose CENU i zato moraju biti strogo pozitivne.
 *
 * `position_size` je ovde iako nije cena: količina od nula ili manje nije
 * pozicija. `gross_pnl_override` NIJE — gubitak je negativan broj i to je
 * njegova jedina ispravna vrednost kad se izgubi.
 */
export const POSITIVE_TRADE_NUMBERS = [
  "entry_price",
  "stop_price",
  "target_price",
  "max_drawdown_price",
  "max_profit_price",
  "position_size",
] as const;

/** Kolone koje moraju biti CEO pozitivan broj. Baza nosi isti CHECK. */
export const POSITIVE_TRADE_INTEGERS = ["time_stop_days"] as const;

const LABELS: Record<string, string> = {
  entry_price: "Entry price",
  stop_price: "Stop price",
  target_price: "Target price",
  max_drawdown_price: "MAE price",
  max_profit_price: "MFE price",
  position_size: "Position size",
  time_stop_days: "Time stop (days)",
};

/**
 * Proveri opseg brojeva u već očišćenom patch-u.
 *
 * Radi nad IZLAZOM `buildPositionPatch`, ne nad sirovim formularom: tamo je
 * koercija već obavljena, pa je ovde svaka vrednost ili broj ili null i provera
 * je o opsegu a ne o tipu. Vrednosti koje su prošle kroz `custom` bag se ne
 * diraju — one nemaju kolonu, pa ni značenje koje bi se moglo tvrditi.
 *
 * Vraća poruku ili null. Prva greška, ne spisak: obrazac je isti kao kod
 * `validateTradingViewSnapshotUrl` i formular ionako prikazuje jednu.
 */
export function invalidTradeNumber(
  columns: Record<string, unknown>,
): string | null {
  for (const key of POSITIVE_TRADE_NUMBERS) {
    const v = columns[key];
    if (v == null) continue;
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
      return `${LABELS[key]} must be greater than zero.`;
    }
  }
  for (const key of POSITIVE_TRADE_INTEGERS) {
    const v = columns[key];
    if (v == null) continue;
    if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) {
      return `${LABELS[key]} must be a whole number greater than zero.`;
    }
  }
  const override = columns.gross_pnl_override;
  if (override != null && (typeof override !== "number" || !Number.isFinite(override))) {
    return "Actual Gross P&L must be a number.";
  }
  return null;
}

/**
 * Jedan fill.
 *
 * `price` je pozitivan iz istog razloga kao cene na poziciji, i to je ovde
 * jedina odbrana koja postoji: `tj_replace_executions` traži samo
 * `price IS NOT NULL AND qty > 0`, a `tj_executions` nosi CHECK samo na `qty`.
 *
 * `executed_at` mora biti vreme koje se da pročitati. RPC ga prima kao
 * `timestamptz` i red sa neispravnim vremenom TIHO ISPADA iz `WHERE` — funkcija
 * vrati manji broj upisanih redova, a `updateTrade` tu vrednost ni ne gleda.
 * Trejd se sačuva sa dva fill-a umesto tri i javi `ok`.
 */
export const executionSchema = z.object({
  side: z.enum(["entry", "exit"]),
  price: z.number().finite().positive(),
  qty: z.number().finite().positive(),
  executed_at: z
    .string()
    .refine((s) => Number.isFinite(Date.parse(s)), "Fill time is not a valid date."),
  fee: z.number().finite(),
  swap_funding: z.number().finite(),
});

/**
 * Strukturni deo submisije — sve osim dinamičkog `fields` bag-a.
 *
 * `fields` ostaje `unknown`-vrednosno namerno: njegov skup ključeva dolazi iz
 * `tj_field_defs`, pa bi zod shema nad njim bila druga definicija onoga što
 * `buildPositionPatch` već radi iz jednog izvora. Brojeve iz njega proverava
 * `invalidTradeNumber`, POSLE koercije.
 */
export const tradeInputSchema = z.object({
  account_id: z.uuid().nullable(),
  trade_no: z.number().int().positive().nullable(),
  fields: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.array(z.string()), z.null()]),
  ),
  executions: z.array(executionSchema),
  trade_phase: z.enum(["planned", "active"]).nullable().optional(),
  current_status: z.string().nullable().optional(),
  playbook_id: z.uuid().nullable().optional(),
  /**
   * 1–5, i strože nego što je bilo.
   *
   * `playbookPatch` je vrednost van opsega TIHO svodio na null — ubeđenost koju
   * je trejder zaista uneo nestajala bi bez ijedne poruke. Sada se odbija, pa
   * se razlika između „nisam ocenio" i „ocena je odbačena" vidi.
   */
  conviction: z.number().int().min(1).max(5).nullable().optional(),
  rule_answers: z.record(z.uuid(), z.boolean()).optional(),
  images: z
    .array(
      z.object({
        kind: z.enum(TRADE_IMAGE_KINDS),
        image_url: z.string(),
      }),
    )
    .optional(),
});

/**
 * Jedan red uvoza.
 *
 * `gross_pnl_override` je jedini broj bez donje granice: gubitak sa izvoda je
 * negativan i to je njegova tačna vrednost. Cena fill-a nije — isto pravilo kao
 * na ručnom unosu, i isti razlog. Brokerov izvod nije nepogrešiv izvor: kolona
 * može biti pogrešno mapirana, a mapiranje koje pomeri cenu u kolonu profita
 * daje negativne „cene" koje bi inače prošle sve do view-a.
 */
export const importItemSchema = z.object({
  decision: z.enum(["create", "merge", "skip"]),
  match_status: z.enum(["new", "match", "duplicate", "ambiguous"]),
  matched_position_id: z.uuid().nullable(),
  instrument: z.string().nullable(),
  direction: z.string().nullable(),
  executions: z.array(executionSchema),
  gross_pnl_override: z.number().finite().nullable(),
  raw: z.record(z.string(), z.string()),
});

/**
 * Omotač uvoza — sve osim samih redova.
 *
 * Redovi se NAMERNO ne proveravaju ovde. `commitImport` već svaki red obrađuje
 * u svom `try`, broji `failed` i skuplja poruku po redu; provera cele liste
 * unapred bi jedan pokvaren red pretvorila u odbijen fajl. Izvod od tri stotine
 * trejdova sa jednom lošom ćelijom treba da uveze dvesta devedeset devet i da
 * kaže koji je red ostao.
 */
export const commitImportSchema = z.object({
  account_id: z.uuid().nullable(),
  filename: z.string(),
  items: z.array(z.unknown()),
});

/**
 * Prva poruka iz zod izveštaja, sa imenom polja ispred nje.
 *
 * Zod-ov podrazumevani tekst („Too small: expected number to be >0") je tačan
 * ali ne kaže GDE. Put do polja je ono što korisniku govori koji red da
 * popravi, pa se lepi ispred — `executions.0.price` postaje čitljivo mesto.
 */
export function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}
