import { z } from "zod";
import { getCurrentSession } from "../auth/server";
import { hasCurrentConsent } from "../auth/legal";
import { AuthError } from "../auth/errors";
export const reviewInput = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("reveal"),
      revision: z.number().int().nonnegative(),
      topicVersion: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      action: z.literal("rate"),
      revision: z.number().int().nonnegative(),
      topicVersion: z.number().int().positive(),
      rating: z.enum(["HARD", "GOOD", "EASY"]),
    })
    .strict(),
]);
export async function reviewUser() {
  const session = await getCurrentSession();
  if (!session) throw new AuthError("unauthorized", 401);
  if (!(await hasCurrentConsent(session.user)))
    throw new AuthError("forbidden", 403);
  return session.user;
}

export const cardIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
