import { cn } from "@/lib/utils";
import { MUTED } from "@/components/primitives";

/**
 * Every screen's outer shell: the max width the content settles at on a wide
 * display, the vertical rhythm between blocks (the theme gap), and the bottom
 * padding that clears the fixed nav.
 */
export function Screen({
  children,
  className,
  /** Drops the top padding, for a screen that opens on full-bleed artwork. */
  flush = false,
}: {
  children: React.ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return (
    <main
      className={cn(
        "mx-auto flex w-full max-w-5xl flex-col gap-[var(--gap)]",
        flush ? "pt-0" : "pt-[var(--gap)]",
        "pb-[calc(var(--nav-h)+var(--gap)+env(safe-area-inset-bottom))]",
        className
      )}
    >
      {children}
    </main>
  );
}

/** Big page title for the screens that are not Home. */
export function ScreenTitle({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="px-[var(--pad)]">
      <h1 className="text-xl font-semibold">{title}</h1>
      {subtitle ? (
        <p className={cn("mt-0.5 text-sm", MUTED)}>{subtitle}</p>
      ) : null}
    </div>
  );
}
