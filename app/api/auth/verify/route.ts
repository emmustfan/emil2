import { transferGuest } from "@/lib/demo/transfer";
import { visitFrom } from "@/lib/demo/request";
import { NextRequest } from "next/server";
import { z } from "zod";
import {
  assertOrigin,
  authFailure,
  authRedirect,
  readInput,
  clientIp,
} from "@/lib/auth/http";
import { verifyEmail } from "@/lib/auth/email";
import { LOGIN_FLOW, SID, cookieOptions } from "@/lib/auth/session";
import { getCurrentSession } from "@/lib/auth/server";
import { hasCurrentConsent } from "@/lib/auth/legal";
import { consumeAuthAttempt } from "@/lib/auth/rate";
export async function POST(request: NextRequest) {
  try {
    assertOrigin(request);
    await consumeAuthAttempt(`verify:${clientIp(request)}`);
    const { token } = z
      .object({ token: z.string().length(43) })
      .strict()
      .parse(await readInput(request));
    const current = await getCurrentSession();
    const result = await verifyEmail(
      token,
      request.cookies.get(LOGIN_FLOW)?.value,
      current?.userId ?? null,
    );
    if (await hasCurrentConsent(result.user))
      await transferGuest(result.user.id, visitFrom(request));
    const response = authRedirect(
      (await hasCurrentConsent(result.user)) ? "/cabinet" : "/onboarding",
    );
    response.cookies.set(SID, result.token, cookieOptions(result.expiresAt));
    response.cookies.delete(LOGIN_FLOW);
    return response;
  } catch (error) {
    return authFailure(error);
  }
}
