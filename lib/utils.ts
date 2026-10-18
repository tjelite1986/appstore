import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** "2026-10-18T10:00:00Z" → "2 h ago". Coarse on purpose: it labels a check, not a clock. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const min = Math.round(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
