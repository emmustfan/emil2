import { NextRequest } from "next/server";
import { assertOrigin, readInput } from "@/lib/auth/http";
import { contentJSON, contentFailure } from "@/lib/content/http";
import { findSession, SID, cookieOptions } from "@/lib/auth/session";
import { startImpersonation } from "@/lib/auth/impersonation";
import { IMPERSONATION_COOKIE } from "@/lib/auth/impersonation-policy";
import { ContentError } from "@/lib/content/errors";
import { workspaceHref } from "@/lib/auth/roles";
export async function POST(request: NextRequest) {
  try {
    assertOrigin(request);
    const admin = await findSession(request.cookies.get(SID)?.value);
    if (!admin) throw new ContentError("Просмотр недоступен.", 403);
    const result = await startImpersonation(
      admin.userId,
      await readInput(request),
    );
    const response = contentJSON({ redirect: workspaceHref(result.role) });
    // A browser-session cookie survives the mode deadline so the next request can audit expiry.
    const { httpOnly, secure, path } = cookieOptions(result.session.expiresAt);
    response.cookies.set(IMPERSONATION_COOKIE, result.token, {
      httpOnly,
      secure,
      path,
      sameSite: "strict",
    });
    return response;
  } catch (error) {
    return contentFailure(error);
  }
}
