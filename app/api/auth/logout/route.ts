import { NextRequest } from "next/server";
import { z } from "zod";
import {
  assertOrigin,
  authFailure,
  authRedirect,
  readInput,
} from "@/lib/auth/http";
import { getCurrentSession } from "@/lib/auth/server";
import { getDb } from "@/lib/db";
import { SID } from "@/lib/auth/session";
export async function POST(request: NextRequest) {
  try {
    assertOrigin(request);
    const { all } = z
      .object({ all: z.enum(["true", "false"]).optional() })
      .strict()
      .parse(await readInput(request));
    const session = await getCurrentSession();
    if (session)
      await getDb().session.deleteMany({
        where: all === "true" ? { userId: session.userId } : { id: session.id },
      });
    const response = authRedirect("/login");
    response.cookies.delete(SID);
    return response;
  } catch (error) {
    return authFailure(error);
  }
}
