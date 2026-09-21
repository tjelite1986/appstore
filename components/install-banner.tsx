"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "appstore.installDismissed";

// Install banner. Chrome only volunteers its own install prompt after opaque
// engagement heuristics, which leaves the install path buried in the three-dot
// menu on a fresh visit; capturing beforeinstallprompt lets us offer it
// straight away. Hidden while already running standalone, after install, or
// once dismissed (remembered per device).
export default function InstallBanner() {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      /* private mode or blocked storage — treat as not dismissed */
    }
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      Boolean((navigator as { standalone?: boolean }).standalone);
    if (dismissed || standalone) return;

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setEvt(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!evt) return null;

  const install = async () => {
    evt.prompt();
    await evt.userChoice.catch(() => {});
    setEvt(null);
  };

  const dismiss = () => {
    setEvt(null);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* nothing to remember it with — it will offer again next visit */
    }
  };

  return (
    <div
      className="fixed inset-x-4 z-40 mx-auto flex max-w-md items-center gap-3 rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[var(--menu)] p-3 text-[color:var(--fg)] shadow-lg backdrop-blur"
      // Clear of the bottom nav and the device's own bottom inset.
      style={{ bottom: "calc(var(--nav-h) + env(safe-area-inset-bottom) + 0.75rem)" }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon-192.png?v=1" alt="" className="h-10 w-10 rounded-[var(--radius)]" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">Install App Store</div>
        <div className="text-xs text-[color:var(--muted)]">
          Get the store on your home screen
        </div>
      </div>
      <button
        type="button"
        onClick={install}
        className="rounded-[var(--radius-sm)] bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
      >
        Install
      </button>
      <button
        type="button"
        onClick={dismiss}
        className="p-1 text-[color:var(--muted)]"
        aria-label="Dismiss"
      >
        <X size={20} />
      </button>
    </div>
  );
}
