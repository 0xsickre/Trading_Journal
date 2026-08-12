"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

/**
 * True once hydrated, false on the server and during the first client render.
 *
 * `useSyncExternalStore` rather than the usual `useState(false)` +
 * `useEffect(() => setMounted(true))`: React's own lint rule rejects a
 * synchronous setState in an effect body (cascading renders), and this hook is
 * exactly the supported way to ask "does the server or the client answer this".
 * The subscribe function is a no-op because the answer never changes after
 * hydration — there is nothing to subscribe to.
 */
const noopSubscribe = () => () => {};
function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true, // client
    () => false, // server
  );
}

/**
 * Light / dark / system switch.
 *
 * HYDRATION-GATED ON PURPOSE. `useTheme()` cannot know the stored preference
 * until the component is running in the browser: on the server, and on React's
 * first client render, `theme` is undefined. Rendering the active state from it
 * straight away would mark a different button as selected on the server than on
 * the client, which is a hydration mismatch — the very thing the provider's
 * blocking script exists to avoid for the page itself.
 *
 * So the first paint draws the row with nothing selected, and the selection
 * appears once hydrated. The three buttons occupy the same space either way, so
 * nothing shifts; only the highlight arrives a tick late.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const hydrated = useHydrated();

  return (
    <div className="flex rounded-md border p-0.5" role="group" aria-label="Theme">
      {OPTIONS.map((o) => {
        const Icon = o.icon;
        const active = hydrated && theme === o.value;
        return (
          <Button
            key={o.value}
            type="button"
            variant="ghost"
            size="sm"
            aria-label={o.label}
            title={o.label}
            aria-pressed={active}
            className={cn(
              "h-7 flex-1 px-0",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground",
            )}
            onClick={() => setTheme(o.value)}
          >
            <Icon className="size-3.5" />
          </Button>
        );
      })}
    </div>
  );
}
