import type { Metadata, Viewport } from "next";
import "./globals.css";
import { FONT_STACK, THEME_VARS } from "@/lib/theme";
import TopBar from "@/components/top-bar";
import BottomNav from "@/components/bottom-nav";
import { currentUser } from "@/lib/current-user";
import { updatableApps } from "@/lib/user-state";

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
        {/* The store is a section of the site the login comes from, so it is
            painted the way that account paints the rest of it: the same accent
            and the same background, overriding the two tokens above and
            nothing else. The derived accent shades have to be recomputed here
            — they were mixed from the default one line up. Both values are
            checked in lib/sso.ts before reaching this string. Absent, either
            because nobody is signed in or because that app does not send it,
            the store keeps its own colours. */}
        {user?.appearance && (
          <style
            dangerouslySetInnerHTML={{
              __html: `:root{--accent:${user.appearance.accent};--accent-soft:color-mix(in srgb, ${user.appearance.accent}, transparent 82%);--accent-text:color-mix(in srgb, ${user.appearance.accent}, white 42%);--app-bg:${user.appearance.bg};}`,
            }}
          />
        )}
      </head>
      <body style={{ fontFamily: FONT_STACK }}>
        <TopBar email={user?.email} />
        {children}
        <BottomNav
          pending={pending}
          parentUrl={process.env.ELITE_APP_URL?.trim() || undefined}
          email={user?.email}
        />
      </body>
    </html>
  );
}
