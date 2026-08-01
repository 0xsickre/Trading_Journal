import {
  LayoutDashboard,
  BookOpen,
  PlusCircle,
  Upload,
  Settings,
  ClipboardCheck,
  BarChart3,
  NotebookPen,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/journal", label: "Journal", icon: BookOpen },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/daily", label: "Dnevni izveštaj", icon: ClipboardCheck },
  { href: "/notebook", label: "Notebook", icon: NotebookPen },
  { href: "/trades/new", label: "New Trade", icon: PlusCircle },
  { href: "/import", label: "Import", icon: Upload },
  { href: "/settings", label: "Settings", icon: Settings },
];
