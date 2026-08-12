import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/app/theme-provider";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ICT Trading Journal",
  description: "Professional ICT trading journal — log, analyze, improve.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // `dark` is still rendered here, and it is no longer a hardcoding — it is
    // the SSR guess that matches `defaultTheme` below.
    //
    // `next-themes` injects a blocking script that runs the moment `<body>`
    // opens, before any page content, and rewrites this class from
    // localStorage (`classList.remove("light","dark")` then add). But until it
    // runs, whatever is on `<html>` is what the `:root` cascade resolves — and
    // `:root` holds the LIGHT palette. Shipping no class at all would leave a
    // sliver where a dark-mode reader's page is computed light. Emitting the
    // default instead means the overwhelmingly common case (dark, which was the
    // only option until now) never changes class at all, and only someone who
    // has explicitly chosen light gets the flip.
    //
    // `suppressHydrationWarning` is required either way: the script mutates the
    // class before React hydrates, so React must accept the DOM over its own
    // output. See Next's "preventing flash before hydration" guide.
    <html
      lang="en"
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider
          attribute="class"
          // Dark stays the default, so nothing changes for anyone who never
          // touches the toggle — this adds a choice, it does not impose one.
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster richColors position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
