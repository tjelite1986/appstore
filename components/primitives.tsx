import { cn } from "@/lib/utils";
import ThumbImage from "@/components/thumb-image";

export const CARD =
  "bg-[var(--card)] rounded-[var(--radius)] border border-[color:var(--border)]";

export const MUTED = "text-[color:var(--muted)]";

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

/** Small caps section heading with an optional trailing link. */
export function SectionTitle({
  title,
  action,
}: {
  title: string;
  action?: string;
}) {
  if (!title && !action) return null;
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="truncate text-sm font-semibold text-[color:var(--muted-2)]">
        {title}
      </h2>
      {action ? (
        <span className={cn("shrink-0 text-xs", MUTED)}>{action} &rarr;</span>
      ) : null}
    </div>
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
      "bg-[var(--card-2)] text-[color:var(--fg)] border border-[color:var(--border)]",
    variant === "ghost" && cn("border border-[color:var(--border)]", MUTED),
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
