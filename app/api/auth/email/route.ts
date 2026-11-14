import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  assertOrigin,
  authFailure,
  clientIp,
  readInput,
} from "@/lib/auth/http";
import { emailSchema } from "@/lib/auth/validation";
import { getCurrentSession } from "@/lib/auth/server";
import { LOGIN_FLOW, cookieOptions } from "@/lib/auth/session";
import { isToken, newToken } from "@/lib/auth/crypto";
import { requestEmail } from "@/lib/auth/email";
import { AuthError } from "@/lib/auth/errors";
export async function POST(request: NextRequest) {
  try {
    assertOrigin(request);
    const input = z
      .object({
        email: emailSchema,
        intent: z.enum(["login", "link"]).default("login"),
      })
      .strict()
      .parse(await readInput(request));
    const session = await getCurrentSession();
    if (input.intent === "link" && !session)
      throw new AuthError("unauthorized", 401);
    if (input.intent === "login" && session)
      throw new AuthError("conflict", 409);
    const previous = request.cookies.get(LOGIN_FLOW)?.value;
    const flow = isToken(previous) ? previous : newToken();
    const expires = await requestEmail(
      input.email,
      clientIp(request),
      flow,
      input.intent === "link" ? session!.userId : null,
    );
    const response = NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
    response.cookies.set(LOGIN_FLOW, flow, cookieOptions(expires));
    return response;
  } catch (error) {
    return authFailure(error);
  }
}
