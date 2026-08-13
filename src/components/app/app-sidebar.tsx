"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, LineChart, LogOut, Menu } from "lucide-react";
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

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function AppSidebar({ email }: { email: string | null }) {
  const pathname = usePathname();
  const PrimaryIcon = PRIMARY_ACTION.icon;

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r bg-sidebar md:flex">
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <LineChart className="size-4" />
        </div>
        <span className="font-semibold">ICT Journal</span>
      </div>

      <div className="p-2 pb-0">
        <Button asChild className="w-full justify-start">
          <Link href={PRIMARY_ACTION.href}>
            <PrimaryIcon className="size-4" />
            {PRIMARY_ACTION.label}
          </Link>
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
                <Link
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
                </Link>
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
      </div>
    </aside>
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
                    <Link href={item.href}>
                      <Icon className="size-4" />
                      {item.label}
                    </Link>
                  </DropdownMenuItem>
                );
              })}
            </Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Both stay OUT of the menu. Logging a trade is the most frequent thing
          anyone does here, and the theme switch only arrived after it went
          missing on this exact breakpoint — neither belongs behind a click. */}
      <Link
        href={PRIMARY_ACTION.href}
        aria-label={PRIMARY_ACTION.label}
        className="flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-primary-foreground"
      >
        <PrimaryIcon className="size-3.5" />
        New
      </Link>
      <div className="shrink-0">
        <ThemeToggle />
      </div>
    </div>
  );
}
