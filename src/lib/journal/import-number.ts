/**
 * Reading a number out of a broker's CSV.
 *
 * The same problem `parseImportTime` has, and the same answer. A price is not a
 * field you may guess at: the import wizard used to strip every character that
 * was not a digit, a dot or a minus, so `2345,67` — how an MT5 export writes it
 * on a European locale, and how every Serbian broker statement writes it —
 * arrived as `234567`. A hundredfold error, on a price, with nothing on screen
 * to say the number had been rewritten.
 *
 * So: parse what is unambiguous, and REFUSE what is not. A refused cell leaves
 * the row without a price, which the wizard already shows as a row that will
 * not import — a visible question instead of an invisible wrong answer.
 */

/**
 * Number out of a broker cell, or null when it cannot be read honestly.
 *
 * Unambiguous, and handled:
 *   `1234.56`      one dot, decimal
 *   `1,234.56`     dot last  → comma groups thousands
 *   `1.234,56`     comma last → dot groups thousands
 *   `2345,67`      one comma, not a 3-digit tail → decimal comma
 *   `1,234,567`    several commas, every tail 3 digits → thousands
 *   `(1.234,56)`   accounting negative
 *   `1 234,56`     space or NBSP as the group separator
 *
 * Ambiguous, and refused:
 *   `1,234`        1234 to a US broker, 1.234 to a German one. Nothing in the
 *                  cell decides it, and both readings are plausible sizes for a
 *                  price, a fee and a quantity alike.
 */
export function parseImportNumber(input: string | null | undefined): number | null {
  if (input == null) return null;

  let s = String(input).trim();
  if (s === "") return null;

  // Accounting negatives: "(1 234,56)" is how a statement writes a debit.
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }

  /**
   * Tick notation is a VALUE, not noise — and it is refused.
   *
   * `110'16` is how a Treasury futures price is written: 110 and 16/32, i.e.
   * 110.5. Stripping the apostrophe as though it were a currency symbol gave
   * `11016` — a hundredfold error on a price, which is the exact class of bug
   * this module was written to stop, arriving through the one character nobody
   * had thought about. Found by running a real ZB statement through it, not by
   * reading the regex.
   *
   * Refused rather than converted, because converting needs the instrument:
   * ZB and ZN quote in 32nds, ZF and ZT in halves and quarters of a 32nd, and
   * this function is handed a bare cell. A refused cell shows on screen as a
   * row that will not import; a converted one would be silently wrong for
   * three of the five contracts.
   *
   * `110-16` is the other spelling and was already refused — the hyphen trips
   * the sign check below.
   */
  if (/['"′″]/.test(s)) return null;

  // Currency symbols, letters and thin/non-breaking spaces are noise around the
  // number, never part of it. Separators are decided below, so they stay.
  s = s.replace(/[^\d.,+-]/g, "");
  if (s === "") return null;

  // A leading or trailing sign, at most one, and never both.
  const lead = /^[+-]/.exec(s)?.[0];
  if (lead) s = s.slice(1);
  if (/[+-]$/.test(s)) {
    // "1234-" is how some exports write a negative. Only if no leading sign.
    if (lead) return null;
    negative = !negative;
    s = s.slice(0, -1);
  }
  if (lead === "-") negative = !negative;
  // Any sign left over is inside the digits — "1-2" is not a number.
  if (/[+-]/.test(s) || s === "") return null;

  const dots = (s.match(/\./g) ?? []).length;
  const commas = (s.match(/,/g) ?? []).length;

  let normalized: string;
  if (dots > 0 && commas > 0) {
    // Whichever comes last is the decimal point; the other groups thousands.
    const decimal = s.lastIndexOf(".") > s.lastIndexOf(",") ? "." : ",";
    const group = decimal === "." ? "," : ".";
    if (!groupsWellFormed(s, group, decimal)) return null;
    normalized = s.split(group).join("").replace(decimal, ".");
  } else if (commas > 0) {
    if (commas === 1) {
      const tail = s.slice(s.indexOf(",") + 1);
      // A lone comma with exactly three digits behind it is the ambiguous case.
      // `1,234` is 1234 or 1.234 depending on a locale the cell does not carry.
      if (tail.length === 3) return null;
      normalized = s.replace(",", ".");
    } else {
      // Several commas can only be grouping — no number has two decimal points.
      if (!groupsWellFormed(s, ",", null)) return null;
      normalized = s.split(",").join("");
    }
  } else if (dots > 1) {
    if (!groupsWellFormed(s, ".", null)) return null;
    normalized = s.split(".").join("");
  } else {
    normalized = s;
  }

  if (!/^\d*\.?\d*$/.test(normalized) || !/\d/.test(normalized)) return null;
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/**
 * Whether `sep` is used consistently as a thousands separator: every group
 * after the first is exactly three digits, and the first is one to three.
 *
 * `1.23.456` fails, and failing is the point — it is not a number in any
 * locale, so reading it as 123456 would be inventing one.
 */
function groupsWellFormed(
  s: string,
  sep: string,
  decimal: string | null,
): boolean {
  const intPart = decimal ? s.slice(0, s.lastIndexOf(decimal)) : s;
  const groups = intPart.split(sep);
  if (groups.length < 2) return true;
  if (!/^\d{1,3}$/.test(groups[0])) return false;
  return groups.slice(1).every((g) => /^\d{3}$/.test(g));
}
