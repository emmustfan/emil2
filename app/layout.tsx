import { AnalyticsConsent } from "@/components/landing/consent";
import type { Metadata } from "next";
import "./globals.css";
import { ru } from "@/lib/i18n/ru";
import { getCurrentSession } from "@/lib/auth/server";
import { ImpersonationBanner } from "@/components/workspace/impersonation-banner";
export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
  title: ru.brand,
  description: ru.description,
  robots: { index: false, follow: false },
};
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getCurrentSession(),
    now = new Date();
  return (
    <html lang="ru">
      <body data-impersonation={session?.readOnly ? "true" : undefined}>
        {session?.impersonation && (
          <ImpersonationBanner
            name={session.user.name || session.user.email || "Пользователь"}
            expiresAt={session.impersonation.expiresAt.toISOString()}
            targetId={session.userId}
            minutes={Math.max(
              0,
              Math.ceil((+session.impersonation.expiresAt - +now) / 60000),
            )}
          />
        )}
        {children}
        {!session?.readOnly && (
          <AnalyticsConsent
            metrikaId={process.env.YANDEX_METRIKA_ID?.match(/^\d{1,12}$/)?.[0]}
          />
        )}
      </body>
    </html>
  );
}
