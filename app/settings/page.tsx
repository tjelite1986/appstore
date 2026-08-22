import {
  Bell,
  Download,
  HardDrive,
  Info,
  Palette,
  ShieldAlert,
  Wifi,
} from "lucide-react";
import { Screen, ScreenTitle } from "@/components/screen";
import RowCard from "@/components/rows";
import { STORE_ROOT } from "@/lib/storage";

/** Settings. Every row is a placeholder — nothing here is wired to state yet. */
export default function SettingsPage() {
  return (
    <Screen>
      <ScreenTitle title="Settings" />

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
