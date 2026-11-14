import { getCurrentSession } from "../auth/server";
import { hasCurrentConsent } from "../auth/legal";
import { AuthError } from "../auth/errors";
export async function requireBuyer(admin = false) {
  const session = await getCurrentSession();
  if (!session) throw new AuthError("unauthorized", 401);
  if (
    !(await hasCurrentConsent(session.user)) ||
    (admin && session.user.role !== "ADMIN")
  )
    throw new AuthError("forbidden", 403);
  return session.user;
}
export const BILLING_RETURN_COOKIE = "billing_return";
