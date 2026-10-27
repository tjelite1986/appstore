import Link from "next/link";
import {
  ArrowDownToLine,
  Check,
  ChevronRight,
  RotateCw,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import ThumbImage from "@/components/thumb-image";

/**
 * A surface. No outline: on the black theme the step from the page to
 * `--card` is the edge, the way the phone stores draw their panels.
 */
export const CARD = "bg-[var(--card)] rounded-[var(--radius-lg)]";

export const MUTED = "text-[color:var(--muted)]";

/**
 * Explanatory text under a control. Brighter than `MUTED` and never below
 * 12px: the notes on Manage used to be 11px at half opacity, which is the
 * difference between a screen that explains itself and one that has to be
 * squinted at.
 */
export const NOTE = "text-xs leading-relaxed text-[color:var(--muted-2)]";

/**
 * What sits behind the artwork.
 *
 * Two answers, and the caller picks by whether it has a chosen colour. The
 * gradient is the fallback *for a missing image*, keyed on the app's `seed` so
 * the same app keeps the same colours on every surface; `background` is a plate
 * put there on purpose for an icon drawn as a transparent logo, and it replaces
 * the gradient rather than sitting under it — a colour someone chose showing
 * through a wash of hsl() is not the colour they chose.
 *
 * Shared with the edit form so the swatch preview there is the real thing.
 */
export function thumbBackground(
  seed = 0,
  background?: string
): React.CSSProperties {
  if (background) return { backgroundColor: background, backgroundImage: "none" };
  const hue = (seed * 47 + 205) % 360;
  return {
    backgroundImage: `linear-gradient(135deg, hsl(${hue} 45% 42% / 0.85), hsl(${
      (hue + 48) % 360
    } 45% 24% / 0.85))`,
  };
}

/**
 * Artwork, with a fallback.
 *
 * `src` is a real file out of the library. When there is none — the app has no
 * icon yet, or the row is a placeholder — the deterministic gradient stands in.
 * It is keyed on the app's `seed`, so the same app keeps the same colours on
 * every surface, which is what a real icon would do. The gradient also sits
 * behind the image, so a slow load is not a hole in the layout.
 *
 * `background` overrules it — see `thumbBackground`.
 */
export function Thumb({
  seed = 0,
  src,
  alt = "",
  className,
  label,
  background,
  fit,
}: {
  seed?: number;
  src?: string;
  alt?: string;
  className?: string;
  label?: string;
  /** A chosen plate for this artwork, `#rrggbb(aa)`. */
  background?: string;
  /** "contain" fits the whole image inside the box instead of cropping it. */
  fit?: "cover" | "contain";
}) {
  return (
    <div
      className={cn(
        "relative flex items-center justify-center overflow-hidden bg-[var(--card-2)]",
        className
      )}
      style={thumbBackground(seed, background)}
    >
      {src ? (
        <ThumbImage src={src} alt={alt} fit={fit} />
      ) : label ? (
        <span className="px-1 text-center text-[10px] font-medium text-white/80">
          {label}
        </span>
      ) : null}
    </div>
  );
}

/**
 * A section heading: big, white, and — when the section goes somewhere — a
 * chevron at the right that leads there. `action` without `href` is a label
 * the way the sketch drew it; with `href` the whole right side is the link.
 */
export function SectionTitle({
  title,
  action,
  href,
}: {
  title: string;
  action?: string;
  href?: string;
}) {
  if (!title && !action) return null;
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="truncate text-[19px] font-bold leading-tight tracking-tight">
        {title}
      </h2>
      {action && href ? (
        <Link
          href={href}
          aria-label={`${action}: ${title}`}
          className={cn(
            "-mr-1.5 flex shrink-0 items-center gap-0.5 rounded-full py-1 pl-2 pr-1 text-xs font-medium transition hover:bg-[var(--card-2)]",
            MUTED
          )}
        >
          {action}
          <ChevronRight size={20} className="text-[color:var(--fg)]" />
        </Link>
      ) : href ? (
        <Link
          href={href}
          aria-label={`See all: ${title}`}
          className="-mr-1.5 shrink-0 rounded-full p-1 transition hover:bg-[var(--card-2)]"
        >
          <ChevronRight size={20} />
        </Link>
      ) : action ? (
        <span className={cn("shrink-0 text-xs", MUTED)}>{action}</span>
      ) : null}
    </div>
  );
}

/** App icon corner, relative to the icon's own size so every size matches. */
export const ICON = "rounded-[var(--icon-radius)]";

/**
 * The round grey button at the end of a row or under a shelf icon.
 *
 * A link to the app's page, not a download: everything the button could
 * offer — the right build for the phone, an OBB beside it, the family picker,
 * a listing that has no file yet — is decided there. The icon says what the
 * page will offer this viewer: an update, an app they already have, or a get.
 */
export function GetButton({
  app,
  wide = false,
  className,
}: {
  app: { slug: string; name: string; installed?: boolean; updateTo?: string; size: string };
  /** Full width under a shelf icon rather than a compact pill in a row. */
  wide?: boolean;
  className?: string;
}) {
  const [Icon, verb] = app.updateTo
    ? [RotateCw, "Update"]
    : app.installed
      ? [Check, "Installed"]
      : app.size && app.size !== "—"
        ? [ArrowDownToLine, "Get"]
        : [ChevronRight, "Open"];
  return (
    <Link
      href={`/app/${app.slug}`}
      aria-label={`${verb} ${app.name}`}
      title={verb}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-[var(--pill)] transition hover:bg-[var(--pill-hover)]",
        wide ? "h-9 w-full" : "h-9 w-14",
        app.updateTo && "text-[color:var(--accent-text)]",
        className
      )}
    >
      <Icon size={19} strokeWidth={2.2} />
    </Link>
  );
}

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "sm" | "md";

/**
 * The button's look, without the element.
 *
 * `Button` below renders a `<span>`: on every screen but Manage these are
 * labels in a layout, and a span cannot be tabbed to or pressed by mistake.
 * The parts that really do something — the import controls — need a real
 * `<button>`, so the classes are shared and the element is the caller's
 * choice, rather than giving every decorative button a disabled handler.
 */
export function buttonClass(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className?: string
): string {
  return cn(
    "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full font-medium",
    size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm",
    variant === "primary" && "bg-[var(--accent)] text-white",
    variant === "secondary" &&
      "bg-[var(--pill)] text-[color:var(--fg)] transition hover:bg-[var(--pill-hover)]",
    variant === "ghost" && cn("transition hover:bg-[var(--card-2)]", MUTED),
    className
  );
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  className,
}: {
  children: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}) {
  return (
    <span className={buttonClass(variant, size, className)}>{children}</span>
  );
}

/**
 * "4.6 ★ · 24 MB" — the one-line meta under an app name.
 *
 * A missing rating is left out rather than printed as "0.0 ★", and so is the
 * dash a shelf listing has instead of a file size: both would read as facts
 * about the app rather than as gaps.
 */
export function metaLine(rating: number, size: string): string {
  const parts: string[] = [];
  if (rating > 0) parts.push(`${rating.toFixed(1)} ★`);
  if (size && size !== "—") parts.push(size);
  return parts.length > 0 ? parts.join(" · ") : "No file yet";
}

/** A small rounded label: a count, a status word, a role. */
export type PillTone = "neutral" | "accent" | "warn" | "danger" | "ok";

const PILL_TONES: Record<PillTone, string> = {
  neutral: "bg-[var(--card-2)] text-[color:var(--muted-2)]",
  accent: "bg-[var(--accent-soft)] text-[color:var(--accent-text)]",
  warn: "bg-[color:color-mix(in_srgb,var(--warn),transparent_85%)] text-[color:var(--warn)]",
  danger:
    "bg-[color:color-mix(in_srgb,var(--danger),transparent_85%)] text-[color:var(--danger)]",
  ok: "bg-[color:color-mix(in_srgb,var(--ok),transparent_85%)] text-[color:var(--ok)]",
};

export function Pill({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: PillTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium leading-4",
        PILL_TONES[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

/**
 * A card with a proper head: an icon in a round plate, a title, something
 * at the right (a count, a status) and a line saying what the card is for.
 *
 * Manage and Settings are built out of these. The explanation lives in the
 * head rather than in small print under the card, so a screen of them reads
 * top-down: what this is, then what it says, then what can be done about it.
 * Server-safe — no handlers — so client panels can wrap themselves in it too.
 */
export function Panel({
  id,
  icon: Icon,
  title,
  aside,
  description,
  children,
  className,
  bodyClassName,
  /** Drop the body padding when the content draws its own rows. */
  flush = false,
}: {
  id?: string;
  icon?: LucideIcon;
  title: string;
  aside?: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  flush?: boolean;
}) {
  return (
    <section id={id} className={cn(CARD, "overflow-hidden scroll-mt-16", className)}>
      <header className="flex items-start gap-3 px-4 pb-1 pt-4">
        {Icon ? (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--pill)] text-[color:var(--accent-text)]">
            <Icon size={17} />
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex min-h-9 items-center gap-2">
            <h2 className="min-w-0 flex-1 truncate text-[17px] font-bold tracking-tight">
              {title}
            </h2>
            {aside}
          </div>
          {description ? <p className={cn("mt-0.5", NOTE)}>{description}</p> : null}
        </div>
      </header>
      <div className={cn(flush ? "" : "p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

/**
 * One number with a name under it. A strip of these opens Manage, so the
 * state of the library is readable before any card is. `href` makes the tile
 * a jump to the card that explains the number.
 */
export function Stat({
  label,
  value,
  sub,
  href,
  icon: Icon,
  tone = "neutral",
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  href?: string;
  icon?: LucideIcon;
  tone?: "neutral" | "accent" | "warn";
  className?: string;
}) {
  const body = (
    <>
      <span className="flex items-center justify-between gap-2">
        <span className={cn("truncate text-[11px] font-medium uppercase tracking-wide", MUTED)}>
          {label}
        </span>
        {Icon ? <Icon size={14} className={cn("shrink-0", MUTED)} /> : null}
      </span>
      <span
        className={cn(
          "mt-1.5 block truncate text-2xl font-bold tabular-nums leading-tight",
          tone === "accent" && "text-[color:var(--accent-text)]",
          tone === "warn" && "text-[color:var(--warn)]"
        )}
      >
        {value}
      </span>
      {sub ? (
        <span className={cn("mt-0.5 block truncate text-xs", MUTED)}>{sub}</span>
      ) : null}
    </>
  );
  const cls = cn(CARD, "flex min-w-0 flex-col px-4 py-3.5", className);
  return href ? (
    <Link href={href} className={cn(cls, "transition hover:bg-[var(--card-2)]")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
