import { redirect } from "next/navigation";
import { Screen, ScreenTitle } from "@/components/screen";
import LoginForm from "@/components/login-form";
import { currentUser } from "@/lib/current-user";
import { safeNext } from "@/lib/safe-next";

export const dynamic = "force-dynamic";

/**
 * Sign in. There is no sign-up next to it: accounts are made by hand
 * (`scripts/users.cjs`), because the store answers on a public hostname and
 * an open registration would hand the 18+ shelf to anyone who asked.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = safeNext((await searchParams).next);
  if (await currentUser()) redirect(next);

  return (
    <Screen>
      <ScreenTitle
        title="Sign in"
        subtitle="Browsing needs no account. Signing in keeps your saved and installed apps."
      />
      <LoginForm next={next} />
    </Screen>
  );
}
