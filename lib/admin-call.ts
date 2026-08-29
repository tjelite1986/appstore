/**
 * One admin request from the browser, as every Manage panel makes it.
 *
 * The panels used to carry a copy each of the same fetch — base path, a JSON
 * header when there is a body, the token header when there is a token, and a
 * readable sentence out of a refusal. They differed only in that sentence and
 * in what to do on being refused, so those are what a caller passes in.
 *
 * No "use client" here on purpose — see `lib/admin-token.ts`.
 */
import { withBasePath } from "@/lib/base-path";
import { adminHeaders } from "@/lib/admin-token";

export type AdminCallOptions = {
  /** What to tell somebody the store does not know — shown on a 401. */
  hint: string;
  /** Statuses handed back as data rather than thrown: 409 where the answer is an offer. */
  accept?: number[];
  /** Runs before the throw on a 401 or 403, for a panel that locks itself. */
  onRefused?: (status: 401 | 403) => void;
};

export async function adminCall(
  path: string,
  init: RequestInit | undefined,
  token: string,
  opts: AdminCallOptions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const res = await fetch(withBasePath(path), {
    ...init,
    headers: {
      // Only a string body is JSON; a FormData body sets its own boundary.
      ...(typeof init?.body === "string" ? { "Content-Type": "application/json" } : {}),
      // Omitted when there is none: the session cookie the browser sends on
      // its own is the normal way in, and an empty header would only ever be
      // a failed guess at the shared token.
      ...adminHeaders(token),
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) {
    opts.onRefused?.(res.status);
    // A 403 comes with its reason — not an admin, a cross-origin write — and
    // the reason is the message. A 401 is the store not knowing who this is,
    // which is what the hint answers.
    throw new Error(res.status === 403 && data.error ? data.error : opts.hint);
  }
  if (!res.ok && !opts.accept?.includes(res.status)) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}
