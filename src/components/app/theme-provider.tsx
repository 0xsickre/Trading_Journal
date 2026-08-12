"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ThemeProviderProps } from "next-themes";

/**
 * Theme provider.
 *
 * `next-themes` was already a dependency and already used — `ui/sonner.tsx`
 * calls `useTheme()` — but nothing ever mounted a provider, so that call has
 * been falling back to `"system"` while `<html>` carried a hardcoded `dark`
 * class. Toasts could therefore render light on a dark page.
 *
 * WHY THIS LIBRARY RATHER THAN THE INLINE SCRIPT from Next's
 * "preventing flash before hydration" guide: the guide's technique IS what
 * `next-themes` does — it injects a blocking script into `<head>` that reads
 * `localStorage` and sets the attribute before first paint. Hand-rolling it
 * would add a second implementation of a thing the repo already ships.
 *
 * `attribute="class"` is not a free choice: `globals.css` declares
 * `@custom-variant dark (&:is(.dark *))` and puts the dark palette under
 * `.dark`, so the class is what the stylesheet is already keyed on. A
 * `data-theme` attribute would need every one of those tokens rewritten.
 */
export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
