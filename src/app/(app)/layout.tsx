import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/user";
import { AppSidebar, MobileTopbar } from "@/components/app/app-sidebar";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Note: default seeding (ensureDefaults) runs on the home page, not here, so it
  // doesn't add a Supabase round-trip to every sub-navigation.

  return (
    <div className="flex min-h-svh w-full">
      <AppSidebar email={user.email ?? null} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileTopbar />
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
