import type { ReactNode } from "react";

/**
 * The heading every (app) route opens with.
 *
 * Written out by hand on all eight pages before this, which is why they drifted:
 * three forgot `min-w-0`, and the descriptions ended up in two languages and
 * three lengths because there was no single place that owned them. One
 * component makes "what a page heading is" answerable once.
 *
 * `description` is a `ReactNode`, not a string, on purpose — `/calendar` marks a
 * word with `<b>`, and narrowing the type would have forced that page to keep
 * its hand-rolled copy, which is the whole thing being fixed.
 *
 * `min-w-0` is unconditional. A flex child defaults to `min-width:auto`, so a
 * long unbroken title (an instrument name, a pasted string) pushes the row wider
 * than its container and the action slides off the edge. The three pages that
 * lacked it were not choosing differently; they were the ones nobody had hit yet.
 *
 * NOT used by `trade-form.tsx`, which carries the same `h1` class over a
 * different thing: its subtitle is `text-sm` with live content (timezone, the
 * missed-at stamp) and sits in an `items-end` row. Pulling that in here would
 * mean a prop per difference, and the component would describe two screens
 * instead of one.
 */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  /** Rendered opposite the title. Omitted entirely when absent — no empty slot. */
  action?: ReactNode;
}) {
  const heading = (
    <div className="min-w-0">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {description && <p className="text-muted-foreground">{description}</p>}
    </div>
  );

  if (!action) return heading;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      {heading}
      {action}
    </div>
  );
}
