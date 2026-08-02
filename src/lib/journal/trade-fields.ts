/**
 * Turning a form submission into a `tj_positions` row patch.
 *
 * Pure on purpose — the split between real columns and the `custom` jsonb bag
 * is the one place a mistake is invisible (a misrouted key does not error, it
 * just never comes back), so it is tested directly instead of only through the
 * server action.
 */

import { splitFieldsByStorage } from "./field-values";
import {
  arrayFieldNames,
  customFieldNames,
  numericFieldNames,
  positionFieldNames,
} from "./form-config";
import type { FieldDef } from "./field-def-types";

export type FormFields = Record<string, string | number | string[] | null>;

export type PositionPatch = {
  /** Column writes, ready to spread into insert/update. */
  columns: Record<string, unknown>;
  /** New values for the `custom` bag — merge, do not replace (see below). */
  custom: Record<string, unknown>;
};

/**
 * Coerce and route every submitted field.
 *
 * Only names the form knows about survive: an unknown key is dropped rather
 * than passed to PostgREST, which would fail the whole write on a typo.
 */
export function buildPositionPatch(
  fields: FormFields,
  defs: readonly FieldDef[] = [],
): PositionPatch {
  const numeric = numericFieldNames(defs);
  const arrays = arrayFieldNames(defs);

  const coerced: Record<string, unknown> = {};
  for (const key of positionFieldNames(defs)) {
    if (!(key in fields)) continue;
    const raw = fields[key];
    if (arrays.has(key)) {
      coerced[key] = Array.isArray(raw)
        ? raw.map((s) => String(s).trim()).filter(Boolean)
        : [];
    } else if (numeric.has(key)) {
      const n = raw === "" || raw == null ? null : Number(raw);
      coerced[key] = n != null && Number.isFinite(n) ? n : null;
    } else if (typeof raw === "string") {
      // Trimmed, and whitespace-only collapses to null — the same treatment the
      // array branch above has always given its members.
      //
      // Untrimmed text SPLITS REPORT BUCKETS. `dimensions.ts` groups on the
      // stored value, so "XAUUSD" and "XAUUSD " are two instruments, each
      // holding half the trades and each below the sample threshold, with
      // nothing on screen to say they are the same symbol. A trailing space is
      // invisible in an input box and survives every copy-paste from a broker
      // statement, so this is not a hypothetical way to produce it.
      const trimmed = raw.trim();
      coerced[key] = trimmed === "" ? null : trimmed;
    } else {
      coerced[key] = raw;
    }
  }

  return splitFieldsByStorage(coerced, customFieldNames(defs));
}

/**
 * Merge new custom values over the ones already stored.
 *
 * A jsonb write replaces the whole document, so assigning the submission
 * wholesale would erase every key the form did not render — which is exactly
 * what happens to a field that has since been deactivated. Its history has to
 * survive an unrelated edit, so the previous bag is the base and only submitted
 * keys are overwritten. An explicit null still clears its key: the user emptying
 * a field must actually empty it.
 */
export function mergeCustom(
  previous: unknown,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const base =
    previous && typeof previous === "object" && !Array.isArray(previous)
      ? { ...(previous as Record<string, unknown>) }
      : {};
  for (const [key, value] of Object.entries(incoming)) {
    if (value == null || (Array.isArray(value) && value.length === 0)) {
      delete base[key];
    } else {
      base[key] = value;
    }
  }
  return base;
}
