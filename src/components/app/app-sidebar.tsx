"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LineChart, LogOut } from "lucide-react";
import { NAV_ITEMS, NAV_SECTIONS, PRIMARY_ACTION } from "@/lib/journal/nav";
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
 * Flat, because a strip this narrow has no room for section headings — but it
 * reads `NAV_ITEMS`, which is derived from the sections, so it stays in the same
 * order as the sidebar without repeating the list.
 *
 * TWO BOXES, not one scrolling row. The nav scrolls sideways because nine
 * entries never fit a phone; the theme switch must NOT, or it would sit off the
 * right edge on every screen and be reachable only by scrolling a strip nobody
 * scrolls to the end of. It is pinned outside the scroll container instead.
 */
export function MobileTopbar() {
  const pathname = usePathname();
  const PrimaryIcon = PRIMARY_ACTION.icon;

  return (
    <div className="flex items-center gap-2 border-b px-2 py-2 md:hidden">
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        <Link
          href={PRIMARY_ACTION.href}
          aria-label={PRIMARY_ACTION.label}
          className="flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-primary-foreground"
        >
          <PrimaryIcon className="size-3.5" />
          New
        </Link>
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium whitespace-nowrap",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground",
              )}
            >
              <Icon className="size-3.5" />
              {item.label}
            </Link>
          );
        })}
      </div>
      <div className="shrink-0">
        <ThemeToggle />
      </div>
    </div>
  );
}
