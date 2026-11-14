import { cache } from "react";
import { cookies } from "next/headers";
import { redirect, forbidden } from "next/navigation";
import { findSession, SID } from "./session";
import { hasCurrentConsent } from "./legal";
export const getCurrentSession = cache(async () =>
  findSession((await cookies()).get(SID)?.value),
);
export async function requireUser(consent = true) {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (consent && !(await hasCurrentConsent(session.user)))
    redirect("/onboarding");
  return session.user;
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
