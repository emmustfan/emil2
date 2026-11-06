import { NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { getCurrentSession } from "@/lib/auth/server";
import { currentLegal } from "@/lib/auth/legal";
import { profileSchema } from "@/lib/auth/validation";
import {
  assertOrigin,
  authFailure,
  authRedirect,
  readInput,
} from "@/lib/auth/http";
import { AuthError } from "@/lib/auth/errors";
export async function POST(request: NextRequest) {
  try {
    assertOrigin(request);
    const session = await getCurrentSession();
    if (!session) throw new AuthError("unauthorized", 401);
    const input = profileSchema
      .extend({
        consent: z.literal("on"),
        consentVersion: z.string(),
        offerVersion: z.string(),
      })
      .strict()
      .parse(await readInput(request));
    const docs = await currentLegal();
    if (
      input.consentVersion !== docs.consent.version ||
      input.offerVersion !== docs.offer.version
    )
      throw new AuthError("invalid", 409);
    const { name, university, course, timezone } = input;
    await getDb().user.update({
      where: { id: session.userId },
      data: {
        name,
        university: university || null,
        course,
        timezone,
        consentPdVersion: docs.consent.version,
        offerVersion: docs.offer.version,
        consentPdAt: new Date(),
      },
    });
    return authRedirect("/cabinet");
  } catch (error) {
    return authFailure(error);
  }
}
