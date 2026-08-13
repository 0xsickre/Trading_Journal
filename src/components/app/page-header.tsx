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
 * `min-w-0` is kept even though nothing sits beside the heading today: it costs
 * nothing, and it is what stops a long unbroken title (an instrument name, a
 * pasted string) from widening the row past its container the moment anything
 * ever does.
 *
 * There is no `action` slot. There was one, for the "New Trade" button `/` and
 * `/journal` each carried — but that button became the sidebar's and the mobile
 * bar's primary action, so the page-level copy was the third on screen at once.
 * With both gone the prop described a case the app no longer has.
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
}: {
  title: string;
  description?: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {description && <p className="text-muted-foreground">{description}</p>}
    </div>
  );
}
