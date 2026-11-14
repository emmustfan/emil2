import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getCurrentSession } from "@/lib/auth/server";
import { hasCurrentConsent } from "@/lib/auth/legal";
import { profileSchema } from "@/lib/auth/validation";
import { assertOrigin, authFailure, readInput } from "@/lib/auth/http";
import { AuthError } from "@/lib/auth/errors";
export async function POST(request: NextRequest) {
  try {
    assertOrigin(request);
    const session = await getCurrentSession();
    if (!session) throw new AuthError("unauthorized", 401);
    if (!(await hasCurrentConsent(session.user)))
      throw new AuthError("forbidden", 403);
    const { name, university, course, timezone } = profileSchema
      .strict()
      .parse(await readInput(request));
    const updated = await getDb().user.updateMany({
      where: { id: session.userId, deletedAt: null, blockedAt: null },
      data: { name, university: university || null, course, timezone },
    });
    if (!updated.count) throw new AuthError("unauthorized", 401);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return authFailure(error);
  }
}
