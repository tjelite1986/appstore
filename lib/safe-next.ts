/**
 * Where to send someone after signing in, from a `?next=` value.
 *
 * Only a path on this host. Resolved rather than pattern-matched: browsers
 * drop tabs and newlines from URLs, so `/\t/evil.example` reads as a path to a
 * prefix check and as `//evil.example` — another host — to the browser.
 */
export function safeNext(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/")) return "/";
  try {
    const url = new URL(value, "http://store.invalid");
    if (url.origin !== "http://store.invalid") return "/";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/";
  }
}
