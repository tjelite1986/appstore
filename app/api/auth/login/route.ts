/**
 * POST /api/auth/login — `{ email, password }` in, a session cookie out.
 *
 * Same-origin only, like every cookie-setting write here: a sibling host on
 * the parent domain must not be able to sign a visitor in to an account of its
 * choosing. Wrong email and wrong password get the same answer, in the same
 * time (see `DUMMY_HASH`).
 */
import { sameOrigin } from "@/lib/admin";
import { sessionCookie, startSession } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  clearFailures,
  clientAddress,
  recordFailure,
  retryAfter,
} from "@/lib/login-throttle";
import { DUMMY_HASH, verifyPassword } from "@/lib/password";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) {
    return Response.json(
      { error: "Cross-origin sign-in is not accepted" },
      { status: 403 }
    );
  }

  const body = (await req.json().catch(() => null)) as {
    email?: unknown;
    password?: unknown;
  } | null;
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || !password || email.length > 320 || password.length > 1024) {
    return Response.json(
      { error: "Email and password are required" },
      { status: 400 }
    );
  }

  const keys = [`ip:${clientAddress(req)}`, `email:${email.toLowerCase()}`];
  const wait = retryAfter(keys);
  if (wait > 0) {
    return Response.json(
      { error: "Too many failed attempts — try again later" },
      { status: 429, headers: { "retry-after": String(wait) } }
    );
  }

  const user = db()
    .prepare("SELECT id, password_hash FROM users WHERE email = ?")
    .get(email) as { id: number; password_hash: string } | undefined;
  const ok = verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok) {
    recordFailure(keys);
    return Response.json(
      { error: "Wrong email or password" },
      { status: 401 }
    );
  }

  clearFailures(keys);
  const { token, expires } = startSession(user.id);
  return Response.json(
    { ok: true },
    { headers: { "set-cookie": sessionCookie(req, token, expires) } }
  );
}
