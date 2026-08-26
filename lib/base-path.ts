/**
 * Where the store is mounted, when it is not mounted at the root.
 *
 * The store can run two ways: on a host of its own (`""`, the default, and
 * what anyone cloning this repo gets), or as a section of a larger site under
 * a path prefix — `STORE_BASE_PATH=/store` at build time, which next.config
 * turns into Next's `basePath`.
 *
 * Next rewrites `<Link>`, `router.push` and `next/image` for us. It does NOT
 * touch a string handed to `fetch`, and it cannot know about a URL we build
 * from `window.location.origin` — so those two go through here. The value is
 * inlined at build time, which is why it has to be NEXT_PUBLIC_.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** An app-absolute path as the browser must ask for it. */
export function withBasePath(path: string): string {
  return `${BASE_PATH}${path}`;
}
