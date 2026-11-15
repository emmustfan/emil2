import { NextRequest } from "next/server";
import { z } from "zod";
import {
  assertOrigin,
  authFailure,
  authRedirect,
  readInput,
} from "@/lib/auth/http";
import { endAdminImpersonations } from "@/lib/auth/impersonation";
import { IMPERSONATION_COOKIE } from "@/lib/auth/impersonation-policy";
import { getDb } from "@/lib/db";
import { SID, findSession } from "@/lib/auth/session";
export async function POST(request: NextRequest) {
  try {
    assertOrigin(request);
    const { all } = z
      .object({ all: z.enum(["true", "false"]).optional() })
      .strict()
      .parse(await readInput(request));
    const session = await findSession(request.cookies.get(SID)?.value);
    if (session) {
      await endAdminImpersonations(session.userId);
      await getDb().session.deleteMany({
        where: all === "true" ? { userId: session.userId } : { id: session.id },
      });
    }
    const response = authRedirect("/login");
    response.cookies.delete(SID);
    response.cookies.delete(IMPERSONATION_COOKIE);
    return response;
  } catch (error) {
    return authFailure(error);
  }
}
