import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { hasCurrentConsent, currentLegal } from "@/lib/auth/legal";
import { AuthShell } from "@/components/auth/shell";
import { ProfileForm } from "@/components/auth/profile-form";
import { authRu } from "@/lib/i18n/ru";
import universities from "@/content-seed/universities.json";
export default async function Onboarding() {
  const user = await requireUser(false);
  if (await hasCurrentConsent(user)) redirect("/cabinet");
  const docs = await currentLegal();
  return (
    <AuthShell
      title={authRu.onboardingTitle}
      description={authRu.onboardingText}
    >
      <ProfileForm
        onboarding
        initial={{
          name: user.name ?? "",
          university: user.university ?? "",
          course: user.course,
          timezone: user.timezone,
        }}
        versions={{ consent: docs.consent.version, offer: docs.offer.version }}
        universities={universities}
      />
      <form method="POST" action="/api/auth/logout" className="mt-6">
        <button className="min-h-11 text-sm text-emerald-800 underline">
          {authRu.logout}
        </button>
      </form>
    </AuthShell>
  );
}
