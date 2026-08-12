import {
  LayoutDashboard,
  BookOpen,
  PlusCircle,
  Upload,
  Settings,
  ClipboardCheck,
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
 * Logging a trade is the most frequent thing anyone does here, and it used to be
 * the SEVENTH entry in a flat list of nine — between Notebook and Import, where
 * nothing about the ordering suggested it mattered more than the rest. It was
 * also a duplicate: `/` and `/journal` both already carry a "New Trade" button.
 *
 * So it leaves the list and becomes the sidebar's one primary action.
 */
export const PRIMARY_ACTION: NavItem = {
  href: "/trades/new",
  label: "New Trade",
  icon: PlusCircle,
};

/**
 * Navigation, grouped by what the reader is trying to DO rather than by the
 * order the routes happened to be built in: look at the aggregate, keep the
 * record, configure the system.
 *
 * `/journal` is labelled "Trades" because that is what the screen is — a sortable
 * table of trades, and README describes it as exactly that ("Tabela trejdova").
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
      { href: "/daily", label: "Daily Report", icon: ClipboardCheck },
      { href: "/notebook", label: "Notebook", icon: NotebookPen },
    ],
  },
  {
    id: "setup",
    label: "Setup",
    items: [
      { href: "/import", label: "Import", icon: Upload },
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
