import { z } from "zod";
import { MAX_OPPORTUNITIES, WORK_SHIFTS } from "./daily-report";

/** Empty text is "not written", stored as null — not as an empty string the readers would have to trim. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Najviše ${max} znakova.`)
    .nullable()
    .transform((v) => (v ? v : null));

const opportunitySchema = z.object({
  note: z.string().trim().min(1, "Prilika bez opisa.").max(500, "Opis prilike: najviše 500 znakova."),
  in_playbook: z.boolean(),
  could_take: z.boolean(),
  easiest: z.boolean(),
});

/**
 * What /daily saves.
 *
 * Phase G (G-2) swapped the 1–5 mental rating for the state before the
 * session — sleep quality and hours, the shift, the child — and gave the close
 * of the day "sutra menjam" and up to three opportunities (G-1). The rating is
 * not in here: a day that has one keeps it, since an upsert only writes the
 * columns it sends.
 *
 * Here, not in the action file: a "use server" module may export only async
 * functions, and the rules below deserve tests of their own.
 */
export const dailyReportSchema = z.object({
  sleep_quality_pct: z.number().int().min(0, "Kvalitet sna: 0–100 %.").max(100, "Kvalitet sna: 0–100 %.").nullable(),
  // numeric(3,1): one decimal, like the column.
  sleep_hours: z
    .number()
    .min(0, "Sati sna: 0–24.")
    .max(24, "Sati sna: 0–24.")
    .nullable()
    .transform((v) => (v == null ? null : Math.round(v * 10) / 10)),
  work_shift: z.enum(WORK_SHIFTS).nullable(),
  with_child: z.boolean().nullable(),
  no_trade_day: z.boolean(),
  // Phase B5: the day's emotions (option-list values).
  psychology_tags: z.array(z.string().trim().min(1).max(60)).max(20),
  tomorrow_change: optionalText(2000),
  opportunities: z
    .array(opportunitySchema)
    .max(MAX_OPPORTUNITIES, `Najviše ${MAX_OPPORTUNITIES} prilike.`)
    .refine((list) => list.filter((o) => o.easiest).length <= 1, "Samo jedna prilika može biti najlakša."),
});

export type SaveDailyReportInput = z.input<typeof dailyReportSchema>;
