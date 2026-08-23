import type { Metadata, Viewport } from "next";
import "./globals.css";
import { FONT_STACK, THEME_VARS } from "@/lib/theme";
import TopBar from "@/components/top-bar";
import BottomNav from "@/components/bottom-nav";
import { updates } from "@/lib/store";

export const metadata: Metadata = {
  title: "App Store",
  description: "An APK archive with its own front door.",
};

export const viewport: Viewport = {
  themeColor: "#100913",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pending = (await updates()).length;

  return (
    <html lang="en">
      <head>
        {/* The tokens are static text built from lib/theme.ts — no user input
            reaches this string, so there is nothing to escape. */}
        <style dangerouslySetInnerHTML={{ __html: THEME_VARS }} />
      </head>
      <body style={{ fontFamily: FONT_STACK }}>
        <TopBar />
        {children}
        <BottomNav pending={pending} />
      </body>
    </html>
  );
}
