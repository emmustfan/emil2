import { getCurrentSession } from "../auth/server";
import { hasCurrentConsent } from "../auth/legal";
import { AuthError } from "../auth/errors";
export async function adminActor() {
  const session = await getCurrentSession();
  if (!session) throw new AuthError("unauthorized", 401);
  if (session.user.role !== "ADMIN" || !(await hasCurrentConsent(session.user)))
    throw new AuthError("forbidden", 403);
  return session.user;
}
