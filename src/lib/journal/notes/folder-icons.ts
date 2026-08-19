import {
  BookOpen,
  Brain,
  Flag,
  Folder,
  GraduationCap,
  Lightbulb,
  Rocket,
  Sparkles,
  Star,
  Target,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

/**
 * The curated set a folder's icon can be, keyed by the name stored in
 * `tj_note_folders.icon`.
 *
 * A fixed TypeScript map, not a database CHECK. The column comment says why:
 * this is presentation, not an invariant the database needs to defend, and the
 * set can grow without a migration — the same call `FieldType` makes for form
 * fields.
 *
 * Twelve entries, matched to what TradeZella's own folder picker offers
 * (folder, lightbulb, flag, chart-up, chart-down, brain/graduation cap,
 * rocket) plus a few more from the same shelf.
 */
export const NOTE_FOLDER_ICONS: Record<string, LucideIcon> = {
  folder: Folder,
  lightbulb: Lightbulb,
  flag: Flag,
  "trending-up": TrendingUp,
  "trending-down": TrendingDown,
  brain: Brain,
  "graduation-cap": GraduationCap,
  rocket: Rocket,
  "book-open": BookOpen,
  star: Star,
  target: Target,
  sparkles: Sparkles,
};

/** Icon names in a stable order, for rendering a picker grid. */
export const NOTE_FOLDER_ICON_NAMES = Object.keys(
  NOTE_FOLDER_ICONS,
) as (keyof typeof NOTE_FOLDER_ICONS)[];

/**
 * Resolves a stored icon name to a component, falling back to the plain
 * folder glyph for `null`, an unrecognized name, or a name from a set that
 * later shrinks. A bad value here is inert, never a crash.
 */
export function folderIcon(name: string | null | undefined): LucideIcon {
  return (name && NOTE_FOLDER_ICONS[name]) || Folder;
}
