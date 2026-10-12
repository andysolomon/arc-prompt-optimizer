import { Fragment } from "react";
import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { AuthSessionProvider } from "@/components/auth/session-provider";
import { OptimizeSessionProvider } from "@/components/optimize/optimize-session-provider";
import { PromptLibraryProvider } from "@/components/library/prompt-library-provider";
import { SiteHeader } from "@/components/site-header";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { authEnabled } from "@/lib/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "Arc Prompt Optimizer",
  description:
    "Paste a prompt. The optimizer renders all nine pattern variants, runs the baseline and each candidate with the model you pick, scores the outputs, and ranks them.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // The session cache is mounted only when sign-in is configured, so an unconfigured deployment never requests /api/auth/session.
  const Session = authEnabled ? AuthSessionProvider : Fragment;
  return (
    <html lang="en" suppressHydrationWarning className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="flex min-h-screen flex-col font-sans">
        <ThemeProvider>
          <TooltipProvider delayDuration={200}>
            <OptimizeSessionProvider>
              <PromptLibraryProvider>
                <Session>
                  <SiteHeader auth={authEnabled} />
                  {children}
                  <Toaster position="bottom-center" />
                </Session>
              </PromptLibraryProvider>
            </OptimizeSessionProvider>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
