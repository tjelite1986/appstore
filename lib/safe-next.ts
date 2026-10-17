/**
 * Where to send someone after signing in, from a `?next=` value.
 *
 * Only a path on this host: `//evil.example` and `/\evil.example` both read as
 * a path at a glance and as another host to a browser.
 */
export function safeNext(value: unknown): string {
  if (typeof value !== "string") return "/";
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/";
  }
  return value;
}
