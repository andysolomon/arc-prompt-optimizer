import { ClerkProvider } from "@clerk/nextjs";
import { shadcn } from "@clerk/ui/themes";
import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { OptimizeSessionProvider } from "@/components/optimize/optimize-session-provider";
import { PromptLibraryProvider } from "@/components/library/prompt-library-provider";
import { SiteHeader } from "@/components/site-header";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { clerkEnabled, readClerkKeys, SIGN_IN_PATH } from "@/lib/clerk-config";
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

const clerkKeys = readClerkKeys();
const accounts = clerkEnabled(clerkKeys);

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const app = (
    <ThemeProvider>
      <TooltipProvider delayDuration={200}>
        <OptimizeSessionProvider>
          <PromptLibraryProvider>
            <SiteHeader auth={accounts} />
            {children}
            <Toaster position="bottom-center" />
          </PromptLibraryProvider>
        </OptimizeSessionProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
  return (
    <html lang="en" suppressHydrationWarning className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="flex min-h-screen flex-col font-sans">
        {accounts ? (
          // Pages stay statically rendered: auth state is resolved on the client, so the provider is not `dynamic`.
          <ClerkProvider publishableKey={clerkKeys.publishableKey} appearance={{ theme: shadcn }} signInUrl={SIGN_IN_PATH} afterSignOutUrl="/">
            {app}
          </ClerkProvider>
        ) : (
          app
        )}
      </body>
    </html>
  );
}
