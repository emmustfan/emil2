import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/server";
import { hasCurrentConsent } from "@/lib/auth/legal";
import { getEnv } from "@/lib/env";
import { getSetting } from "@/lib/settings";
import { AuthShell } from "@/components/auth/shell";
import { EmailForm } from "@/components/auth/email-form";
import { TelegramWidget } from "@/components/auth/telegram-widget";
import { authRu } from "@/lib/i18n/ru";
export default async function Login() {
  const session = await getCurrentSession();
  if (session)
    redirect(
      (await hasCurrentConsent(session.user)) ? "/cabinet" : "/onboarding",
    );
  const env = getEnv();
  return (
    <AuthShell title={authRu.loginTitle} description={authRu.loginDescription}>
      <EmailForm resendSeconds={await getSetting("auth.resendSeconds")} />
      <div className="my-6 text-center text-xs text-stone-400">{authRu.or}</div>
      <TelegramWidget
        username={
          env.TELEGRAM_BOT_TOKEN ? env.TELEGRAM_BOT_USERNAME : undefined
        }
      />
    </AuthShell>
  );
}
