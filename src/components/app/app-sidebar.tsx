"use client";

import { Fragment, useEffect, useRef, useState, type ComponentProps } from "react";
import { usePathname } from "next/navigation";
import { ChevronDown, LineChart, LogOut, Menu, Pin, PinOff } from "lucide-react";
import { NAV_ITEMS, NAV_SECTIONS, PRIMARY_ACTION } from "@/lib/journal/nav";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { logout } from "@/app/login/actions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { NavLink } from "@/components/app/nav-link";
import { getSidebarPinned, setSidebarPinned } from "@/lib/journal/sidebar-prefs";

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

const REPO_URL = "https://github.com/0xsickre/Trading_Journal";

/**
 * AGPL § 13: a copy reached over a network owes its source to the people using
 * it, and the offer has to be reachable from the app rather than merely true
 * somewhere. Hence a link in the chrome, not a line in the README.
 *
 * Pinned to the DEPLOYED commit, not `main` — § 13 asks for the source of the
 * version running, and `main` moves on within the hour.
 *
 * The `NEXT_PUBLIC_` prefix is load-bearing: both chromes are client
 * components, so a bare `VERCEL_GIT_COMMIT_SHA` reads `undefined` in the
 * browser and every link would quietly degrade to `main` — right-looking and
 * wrong. Vercel exposes the prefixed one itself while "Automatically expose
 * System Environment Variables" is on.
 */
const SOURCE_URL = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA
  ? `${REPO_URL}/tree/${process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA}`
  : REPO_URL;

/**
 * The rest of the props are forwarded because `DropdownMenuItem asChild` hands
 * its child the `role`, the ref and its own handlers. Dropping them renders an
 * anchor the menu cannot see — which is a link that is present and unreachable.
 */
function SourceLink({ className, ...props }: ComponentProps<"a">) {
  return (
    <a
      {...props}
      href={SOURCE_URL}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "block text-xs text-muted-foreground transition-colors hover:text-foreground",
        className,
      )}
    >
      Source code (AGPL-3.0)
    </a>
  );
}

/** How long the pointer may leave the sidebar before it slides away. */
const CLOSE_DELAY_MS = 250;

/**
 * The desktop sidebar. Auto-hides by default: it sits off the left edge and
 * slides in over the page when the pointer reaches that edge (or keyboard focus
 * lands in it), then slides away when the pointer leaves — the page keeps the
 * full width until the menu is wanted. The pin in its header keeps it open in
 * the layout instead, remembered per browser (`sidebar-prefs.ts`).
 */
export function AppSidebar({ email }: { email: string | null }) {
  const pathname = usePathname();
  const PrimaryIcon = PRIMARY_ACTION.icon;
  const [pinned, setPinned] = useState(false);
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (getSidebarPinned()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- external-store init
      setPinned(true);
    }
    return () => clearTimeout(closeTimer.current);
  }, []);

  function show() {
    clearTimeout(closeTimer.current);
    setOpen(true);
  }
  // A short grace period, so brushing past the edge or crossing the border on
  // the way to a link does not make the menu flicker shut.
  function hideSoon() {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  }
  function togglePin() {
    const next = !pinned;
    setPinned(next);
    setSidebarPinned(next);
    setOpen(false);
  }

  const floating = !pinned;

  // Bars pinned to the bottom of a page (the trade form's totals, the daily and
  // weekly save bars) start where the page does. That is past the sidebar only
  // while it is pinned into the layout; hidden, the page — and the bar — take
  // the full width. They read the offset from this variable.
  useEffect(() => {
    document.documentElement.style.setProperty("--sidebar-offset", pinned ? "15rem" : "0px");
  }, [pinned]);

  return (
    <>
      {floating && (
        // The edge the pointer reaches to call the menu. Invisible, a few pixels
        // wide, and only while the sidebar is hidden.
        <div
          aria-hidden
          data-testid="sidebar-edge"
          className="fixed inset-y-0 left-0 z-40 hidden w-2 md:block"
          onMouseEnter={show}
        />
      )}
      <aside
        data-state={pinned ? "pinned" : open ? "open" : "closed"}
        onMouseEnter={floating ? show : undefined}
        onMouseLeave={floating ? hideSoon : undefined}
        onFocus={floating ? show : undefined}
        onBlur={
          floating
            ? (e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) hideSoon();
              }
            : undefined
        }
        onKeyDown={floating ? (e) => e.key === "Escape" && setOpen(false) : undefined}
        className={cn(
          "hidden w-60 shrink-0 flex-col border-r bg-sidebar md:flex",
          floating &&
            "fixed inset-y-0 left-0 z-50 overflow-y-auto shadow-xl transition-transform duration-200 ease-out",
          floating && !open && "-translate-x-full shadow-none",
        )}
      >
        <div className="flex h-14 items-center gap-2 border-b px-4">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <LineChart className="size-4" />
          </div>
          <span className="font-semibold">ICT Journal</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="ml-auto size-7 text-muted-foreground"
            aria-pressed={pinned}
            aria-label={pinned ? "Unpin sidebar — hide it until the pointer reaches the left edge" : "Pin sidebar open"}
            title={pinned ? "Auto-hide the sidebar" : "Keep the sidebar open"}
            onClick={togglePin}
          >
            {pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
          </Button>
        </div>

        <div className="p-2 pb-0">
          <Button asChild className="w-full justify-start">
            <NavLink href={PRIMARY_ACTION.href}>
              <PrimaryIcon className="size-4" />
              {PRIMARY_ACTION.label}
            </NavLink>
          </Button>
        </div>

        <nav className="flex-1 space-y-4 p-2">
          {NAV_SECTIONS.map((section) => (
            <div key={section.id} className="space-y-1">
              <p className="px-3 pt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
                {section.label}
              </p>
              {section.items.map((item) => {
                const active = isActive(pathname, item.href);
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                    )}
                  >
                    <Icon className="size-4" />
                    {item.label}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="space-y-2 border-t p-2">
          <ThemeToggle />
          {email && (
            <p className="truncate px-3 pt-1 text-xs text-muted-foreground">
              {email}
            </p>
          )}
          <form action={logout}>
            <Button
              type="submit"
              variant="ghost"
              className="w-full justify-start text-muted-foreground"
            >
              <LogOut className="size-4" />
              Sign out
            </Button>
          </form>
          <SourceLink className="px-3 pb-1" />
        </div>
      </aside>
    </>
  );
}

/**
 * Compact top bar shown on mobile (where the sidebar is hidden).
 *
 * This used to be nine chips in a horizontally scrolling strip. Nine never fit
 * a phone, so the last three were reachable only by scrolling a row nobody
 * scrolls — and the strip spent a full bar of vertical space without ever
 * saying which page you were on, because the active chip was usually off-screen
 * too.
 *
 * A menu instead, built from `NAV_SECTIONS` — the SAME source the sidebar reads,
 * so the two cannot drift into different groupings. `DropdownMenuLabel` carries
 * each section heading, which the flat strip had no room for at all.
 *
 * No drawer / `Sheet`: `ui/dialog.tsx` hardcodes centring and `zoom-in-95`, so a
 * side panel would be a fight with the component's own classes. `DropdownMenu`
 * is already here and does the job.
 */
export function MobileTopbar() {
  const pathname = usePathname();
  const PrimaryIcon = PRIMARY_ACTION.icon;

  // The trigger names where you ARE. The strip this replaced could not: it
  // showed nine chips of which the active one was often scrolled out of sight,
  // so the bar took space without answering the first question a reader has.
  const current = NAV_ITEMS.find((i) => isActive(pathname, i.href));

  return (
    <div className="flex items-center gap-2 border-b px-2 py-2 md:hidden">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 min-w-0 flex-1 justify-start gap-2 px-2"
          >
            <Menu className="size-4 shrink-0" />
            <span className="truncate font-medium">
              {current?.label ?? "Menu"}
            </span>
            <ChevronDown className="ml-auto size-4 shrink-0 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {NAV_SECTIONS.map((section, i) => (
            <Fragment key={section.id}>
              {i > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
                {section.label}
              </DropdownMenuLabel>
              {section.items.map((item) => {
                const Icon = item.icon;
                return (
                  <DropdownMenuItem key={item.href} asChild>
                    <NavLink href={item.href}>
                      <Icon className="size-4" />
                      {item.label}
                    </NavLink>
                  </DropdownMenuItem>
                );
              })}
            </Fragment>
          ))}
          {/* The sidebar is `hidden … md:flex`, so a link that lives only there
              is nowhere on a phone — the exact shape of the bug that put
              `app-sidebar.render.test.tsx` on disk. § 13 says "all users". */}
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <SourceLink />
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Both stay OUT of the menu. Logging a trade is the most frequent thing
          anyone does here, and the theme switch only arrived after it went
          missing on this exact breakpoint — neither belongs behind a click. */}
      <NavLink
        href={PRIMARY_ACTION.href}
        aria-label={PRIMARY_ACTION.label}
        className="flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-primary-foreground"
      >
        <PrimaryIcon className="size-3.5" />
        New
      </NavLink>
      <div className="shrink-0">
        <ThemeToggle />
      </div>
    </div>
  );
}
