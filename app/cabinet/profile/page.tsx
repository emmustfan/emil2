import { requireUser } from "@/lib/auth/server";
import { getEnv } from "@/lib/env";
import { getSetting } from "@/lib/settings";
import { AuthShell } from "@/components/auth/shell";
import { ProfileForm } from "@/components/auth/profile-form";
import { EmailForm } from "@/components/auth/email-form";
import { TelegramWidget } from "@/components/auth/telegram-widget";
import { authRu } from "@/lib/i18n/ru";
import universities from "@/content-seed/universities.json";
export default async function Profile() {
  const user = await requireUser();
  const env = getEnv();
  return (
    <AuthShell title={authRu.profileTitle}>
      <ProfileForm
        initial={{
          name: user.name ?? "",
          university: user.university ?? "",
          course: user.course,
          timezone: user.timezone,
        }}
        universities={universities}
      />
      <section className="mt-10 border-t border-stone-200 pt-7">
        <h2 className="text-xl font-semibold">{authRu.methods}</h2>
        <p className="mt-4 text-sm">
          {authRu.email}: {user.email ?? authRu.notLinked}
          {user.emailVerifiedAt && ` · ${authRu.confirmed}`}
        </p>
        <p className="my-5 text-sm leading-6 text-stone-500">
          {authRu.emailChangeNote}
        </p>
        <EmailForm
          intent="link"
          resendSeconds={await getSetting("auth.resendSeconds")}
        />
        <p className="mt-7 mb-4 text-sm">
          Telegram:{" "}
          {user.telegramId
            ? user.telegramUsername
              ? `@${user.telegramUsername}`
              : authRu.confirmed
            : authRu.notLinked}
        </p>
        {!user.telegramId && (
          <TelegramWidget
            intent="link"
            username={
              env.TELEGRAM_BOT_TOKEN ? env.TELEGRAM_BOT_USERNAME : undefined
            }
          />
        )}
      </section>
      <form method="POST" action="/api/auth/logout" className="mt-8">
        <input type="hidden" name="all" value="true" />
        <button className="min-h-11 text-sm text-emerald-800 underline">
          {authRu.logoutAll}
        </button>
      </form>
    </AuthShell>
  );
}
