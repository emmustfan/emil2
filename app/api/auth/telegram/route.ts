import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  assertOrigin,
  authFailure,
  clientIp,
  readInput,
} from "@/lib/auth/http";
import { loginTelegram } from "@/lib/auth/telegram-login";
import { cookieOptions, SID } from "@/lib/auth/session";
import { getCurrentSession } from "@/lib/auth/server";
import { hasCurrentConsent } from "@/lib/auth/legal";
import { AuthError } from "@/lib/auth/errors";
import { consumeAuthAttempt } from "@/lib/auth/rate";
export async function POST(request: NextRequest) {
  try {
    assertOrigin(request);
    const input = z
      .object({
        data: z.unknown(),
        intent: z.enum(["login", "link"]).default("login"),
      })
      .strict()
      .parse(await readInput(request));
    await consumeAuthAttempt(`telegram:${clientIp(request)}`);
    const current = await getCurrentSession();
    if (input.intent === "link" && !current)
      throw new AuthError("unauthorized", 401);
    if (input.intent === "login" && current)
      throw new AuthError("conflict", 409);
    const result = await loginTelegram(
      input.data,
      input.intent === "link" ? current!.userId : null,
    );
    const response = NextResponse.json(
      {
        redirect: (await hasCurrentConsent(result.user))
          ? "/cabinet"
          : "/onboarding",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
    response.cookies.set(SID, result.token, cookieOptions(result.expiresAt));
    return response;
  } catch (error) {
    return authFailure(error);
  }
}
