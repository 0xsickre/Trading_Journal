import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureDefaults } from "@/lib/journal/ensure-defaults";
import { AppSidebar, MobileTopbar } from "@/components/app/app-sidebar";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // First-login seed of dropdown lists, options, instruments and an account.
  await ensureDefaults();

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
