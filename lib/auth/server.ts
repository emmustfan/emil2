import { cache } from "react";
import { cookies } from "next/headers";
import { redirect, forbidden } from "next/navigation";
import { SID } from "./session";
import { resolveCurrentSession } from "./impersonation";
import { IMPERSONATION_COOKIE } from "./impersonation-policy";
import { hasCurrentConsent } from "./legal";
export const getCurrentSession = cache(async () => {
  const jar = await cookies();
  return resolveCurrentSession(
    jar.get(SID)?.value,
    jar.get(IMPERSONATION_COOKIE)?.value,
  );
});
export async function requireUser(consent = true) {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (consent && !(await hasCurrentConsent(session.user)))
    redirect("/onboarding");
  return { ...session.user, readOnly: session.readOnly };
}
export async function requireEditor() {
  const user = await requireUser(false);
  if (user.role !== "EDITOR" && user.role !== "ADMIN") forbidden();
  if (!(await hasCurrentConsent(user))) redirect("/onboarding");
  return user;
}
export async function requireAdmin() {
  const user = await requireUser(false);
  if (user.role !== "ADMIN") forbidden();
  if (!(await hasCurrentConsent(user))) redirect("/onboarding");
  return user;
}
