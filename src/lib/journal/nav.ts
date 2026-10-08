import {
  LayoutDashboard,
  BookOpen,
  Upload,
  Settings,
  ClipboardCheck,
  BookMarked,
  BarChart3,
  CalendarDays,
  NotebookPen,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

export type NavSection = {
  id: string;
  label: string;
  items: NavItem[];
};

/**
 * The sidebar's one primary action: the import. Since phase O (08.10.2026) it is
 * the only way a trade enters the journal — the day's TopstepX trades and orders
 * exports, then the details filled in from the recording. The plan form and the
 * after-the-close log are gone; a setup not taken has its own small page.
 */
export const PRIMARY_ACTION: NavItem = {
  href: "/import",
  label: "Import",
  icon: Upload,
};

/**
 * Navigation, grouped by what the reader is trying to DO rather than by the
 * order the routes happened to be built in: look at the aggregate, keep the
 * record, configure the system.
 *
 * `/journal` is labelled "Trades" because that is what the screen is — a sortable
 * table of trades, and README describes it as exactly that ("Trade table").
 * Inside a section already called JOURNAL, an entry called "Journal" would have
 * the reader guessing which of the two was which.
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    id: "overview",
    label: "Overview",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/reports", label: "Reports", icon: BarChart3 },
      { href: "/calendar", label: "Calendar", icon: CalendarDays },
    ],
  },
  {
    id: "journal",
    label: "Journal",
    items: [
      { href: "/journal", label: "Trades", icon: BookOpen },
      // Beside Trades, not under Setup. A playbook is judged by what it did, so
      // it belongs with the record rather than with the dropdown lists.
      { href: "/playbooks", label: "Playbooks", icon: BookMarked },
      // Only the daily check-in: the weekly review left the journal. Closing a
      // day or a week is a conversation with the mentor (`trading-mentor`),
      // fed by the mentor pack; the journal measures and exports.
      { href: "/daily", label: "Daily Check-in", icon: ClipboardCheck },
      { href: "/notebook", label: "Notebook", icon: NotebookPen },
    ],
  },
  {
    id: "setup",
    label: "Setup",
    items: [
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

/**
 * The same items, flat, in section order — for the mobile strip, which has no
 * room for headings.
 *
 * DERIVED, never hand-maintained: a second literal list is a second answer to
 * "what is in the menu", and the two would drift the first time an entry was
 * added to only one of them.
 */
export const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);
