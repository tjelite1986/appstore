import {
  Bell,
  Bookmark,
  Download,
  HardDrive,
  Info,
  Palette,
  PackageCheck,
  ShieldAlert,
  UserRound,
  Wifi,
} from "lucide-react";
import { Screen, ScreenTitle } from "@/components/screen";
import RowCard from "@/components/rows";
import ForgetStateButton from "@/components/forget-state-button";
import { STORE_ROOT } from "@/lib/storage";
import { currentUser } from "@/lib/current-user";
import { adultsAllowed, readState } from "@/lib/user-state";
import AdultsToggle from "@/components/adults-toggle";

export const dynamic = "force-dynamic";

/**
 * Settings. The Account block is real — it is the one place that says what this
 * store is keeping about a person, and offers to stop. Everything below it is
 * still a placeholder row.
 */
export default async function SettingsPage() {
  const user = await currentUser();
  const state = user ? readState(user.id) : null;
  const kept = state ? state.saved.size + state.installed.size : 0;

  return (
    <Screen>
      <ScreenTitle title="Settings" />

      <RowCard
        title="Account"
        rows={
          user
            ? [
                { label: "Signed in as", value: user.email, Icon: UserRound },
                {
                  label: "Saved",
                  value: String(state?.saved.size ?? 0),
                  Icon: Bookmark,
                },
                {
                  label: "Marked installed",
                  value: String(state?.installed.size ?? 0),
                  Icon: PackageCheck,
                },
              ]
            : [
                {
                  label: "Not signed in",
                  value: "Browsing only",
                  Icon: UserRound,
                },
              ]
        }
      />
      {user && (
        <div className="px-[var(--pad)]">
          <ForgetStateButton count={kept} />
        </div>
      )}

      <AdultsToggle on={adultsAllowed(user?.id ?? null)} signedIn={!!user} />

      <RowCard
        title="Appearance"
        rows={[
          { label: "Theme", value: "Dark", Icon: Palette, href: "/settings" },
          { label: "Accent", value: "Blue", Icon: Palette, href: "/settings" },
          { label: "Background", value: "Plum", Icon: Palette, href: "/settings" },
        ]}
      />

      <RowCard
        title="Downloads"
        rows={[
          { label: "Auto-update apps", Icon: Download, toggle: true, on: true },
          { label: "Wi-Fi only", Icon: Wifi, toggle: true, on: true },
          { label: "Notify about updates", Icon: Bell, toggle: true, on: false },
        ]}
      />

      <RowCard
        title="Content"
        rows={[
          { label: "Show 18+ apps", Icon: ShieldAlert, toggle: true, on: false },
        ]}
      />

      <RowCard
        title="Storage"
        rows={[
          { label: "Library", value: STORE_ROOT, Icon: HardDrive },
          { label: "Version", value: "0.1.0 · layout only", Icon: Info },
        ]}
      />
    </Screen>
  );
}
