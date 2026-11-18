import { NextRequest } from "next/server";
import { assertOrigin, authRedirect } from "@/lib/auth/http";
import { contentFailure } from "@/lib/content/http";
import { findSession, SID } from "@/lib/auth/session";
import { stopImpersonation } from "@/lib/auth/impersonation";
import { IMPERSONATION_COOKIE } from "@/lib/auth/impersonation-policy";
import { workspaceHref } from "@/lib/auth/roles";
export async function POST(request: NextRequest) {
  try {
    assertOrigin(request);
    const admin = await findSession(request.cookies.get(SID)?.value);
    const targetId = admin
      ? await stopImpersonation(
          admin.userId,
          request.cookies.get(IMPERSONATION_COOKIE)?.value,
        )
      : null;
    const response = authRedirect(
      admin
        ? admin.user.role !== "ADMIN"
          ? workspaceHref(admin.user.role)
          : targetId
            ? `/admin/users/${targetId}`
            : "/admin"
        : "/login",
    );
    response.cookies.delete(IMPERSONATION_COOKIE);
    return response;
  } catch (error) {
    return contentFailure(error);
  }
}
