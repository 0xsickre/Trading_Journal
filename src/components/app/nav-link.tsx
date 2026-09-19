"use client";

import Link from "next/link";
import { useState, type ComponentProps } from "react";

/**
 * A `Link` that loads its whole page when the pointer arrives, not when clicked.
 *
 * Every page in the app is dynamic (it reads the session), and Next's default
 * prefetch for a dynamic page stops at the loading skeleton — the click then
 * waits for the full server render. Switching to a FULL prefetch on hover
 * starts that render in the moment between pointing and clicking, so the page
 * is usually there by the time the click lands. Kept for a while by
 * `staleTimes.static` in `next.config.ts`.
 *
 * On hover and focus rather than on view: a full prefetch of every menu entry
 * on every page load would render the whole app in the background each time.
 * The shape is the one Next's prefetching guide gives.
 *
 * Every other prop — including the ref and handlers a Radix `asChild` hands
 * down — is forwarded, and our handlers run alongside the caller's.
 */
export function NavLink({ onMouseEnter, onFocus, onTouchStart, ...props }: ComponentProps<typeof Link>) {
  const [warm, setWarm] = useState(false);
  return (
    <Link
      {...props}
      prefetch={warm ? true : null}
      onMouseEnter={(e) => {
        setWarm(true);
        onMouseEnter?.(e);
      }}
      onFocus={(e) => {
        setWarm(true);
        onFocus?.(e);
      }}
      onTouchStart={(e) => {
        setWarm(true);
        onTouchStart?.(e);
      }}
    />
  );
}
