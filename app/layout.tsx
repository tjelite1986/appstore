import type { Metadata, Viewport } from "next";
import "./globals.css";
import { FONT_STACK, THEME_VARS } from "@/lib/theme";
import TopBar from "@/components/top-bar";
import BottomNav from "@/components/bottom-nav";
import { currentUser } from "@/lib/current-user";
import { updatableApps } from "@/lib/user-state";
import PwaRegister from "@/components/pwa-register";
import InstallBanner from "@/components/install-banner";

export const metadata: Metadata = {
  title: "App Store",
  description: "An APK archive with its own front door.",
  manifest: "/manifest.webmanifest",
  applicationName: "App Store",
  appleWebApp: {
    capable: true,
    title: "App Store",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/favicon-32.png?v=1",
    apple: "/apple-touch-icon.png?v=1",
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Per account: the badge counts what *this* person is behind on, so a
  // signed-out visitor sees no number rather than somebody else's. The header
  // gets the same answer as a prop rather than asking again from the client —
  // one lookup, and no frame where the avatar is wrong.
  const user = await currentUser();
  const pending = (await updatableApps(user?.id ?? null)).length;

  return (
    <html lang="en">
      <head>
        {/* The tokens are static text built from lib/theme.ts — no user input
            reaches this string, so there is nothing to escape. */}
        <style dangerouslySetInnerHTML={{ __html: THEME_VARS }} />
      </head>
      <body style={{ fontFamily: FONT_STACK }}>
        <TopBar email={user?.email} />
        {children}
        <BottomNav pending={pending} />
        <InstallBanner />
        <PwaRegister />
      </body>
    </html>
  );
}
