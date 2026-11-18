import { ContentError } from "./lib/content/errors";
import { isStudentProgressPath } from "./lib/progress/routes";
import { assertCanViewStudent } from "./lib/progress/access";
import { BILLING_RETURN_COOKIE } from "./lib/billing/http";
import { safePricingReturn } from "./lib/billing/policy";
import { NextRequest, NextResponse } from "next/server";
import { SID, cookieOptions } from "./lib/auth/session";
import {
  resolveCurrentSession,
  auditImpersonationWrite,
  type CurrentSession,
} from "./lib/auth/impersonation";
import {
  IMPERSONATION_COOKIE,
  IMPERSONATION_WRITE_MESSAGE,
  isImpersonationWrite,
} from "./lib/auth/impersonation-policy";
import { hasCurrentConsent } from "./lib/auth/legal";
import { getEnv } from "./lib/env";
import { newToken, isToken } from "./lib/auth/crypto";
import { GUEST_COOKIE } from "./lib/lessons/actor";
import { getSetting } from "./lib/settings";
import {
  ANON_COOKIE,
  DEMO_COOKIE,
  TOUCH_COOKIE,
  firstTouch,
} from "./lib/analytics/identity";
import { authRu } from "./lib/i18n/ru";
export async function proxy(request: NextRequest) {
  const token = request.cookies.get(SID)?.value;
  const modeToken = request.cookies.get(IMPERSONATION_COOKIE)?.value;
  const session = await resolveCurrentSession(
    token,
    modeToken,
    !request.nextUrl.pathname.startsWith("/api/"),
  );
  if (
    session?.readOnly &&
    isImpersonationWrite(request.method, request.nextUrl.pathname)
  ) {
    await auditImpersonationWrite(
      session,
      request.method,
      request.nextUrl.pathname,
    );
    return NextResponse.json(
      { error: IMPERSONATION_WRITE_MESSAGE },
      {
        status: 403,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }
  const response = await routeRequest(request, session);
  if (modeToken && !session?.impersonation)
    response.cookies.delete(IMPERSONATION_COOKIE);
  return response;
}
async function routeRequest(
  request: NextRequest,
  session: CurrentSession | null,
) {
  const token = request.cookies.get(SID)?.value;
  const path = request.nextUrl.pathname;
  if (path.startsWith("/api/")) {
    const response = NextResponse.next();
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
  if (
    ["/", "/demo", "/login", "/pricing"].includes(path) ||
    path.startsWith("/subjects") ||
    path.startsWith("/learn/")
  ) {
    if (
      session &&
      path.startsWith("/learn/") &&
      !(await hasCurrentConsent(session.user))
    )
      return NextResponse.redirect(new URL("/onboarding", getEnv().APP_URL));
    const headers = new Headers(request.headers);
    const updates: { name: string; value: string; days: number }[] = [];
    const legacy = request.cookies.get(GUEST_COOKIE)?.value;
    let anon = request.cookies.get(ANON_COOKIE)?.value;
    if (!isToken(anon)) {
      anon = isToken(legacy) ? legacy : newToken();
      updates.push({ name: ANON_COOKIE, value: anon!, days: 365 });
    }
    if (!isToken(request.cookies.get(DEMO_COOKIE)?.value))
      updates.push({
        name: DEMO_COOKIE,
        value: isToken(legacy) ? legacy : anon!,
        days: await getSetting("lesson.guestDays"),
      });
    if (!isToken(legacy))
      updates.push({
        name: GUEST_COOKIE,
        value:
          request.cookies.get(DEMO_COOKIE)?.value ??
          updates.find((c) => c.name === DEMO_COOKIE)?.value ??
          anon!,
        days: await getSetting("lesson.guestDays"),
      });
    if (!request.cookies.has(TOUCH_COOKIE))
      updates.push({
        name: TOUCH_COOKIE,
        value: JSON.stringify(
          firstTouch(request.nextUrl, request.headers.get("referer")),
        ),
        days: 30,
      });
    for (const cookie of updates)
      request.cookies.set(cookie.name, cookie.value);
    headers.set("cookie", request.cookies.toString());
    const response = NextResponse.next({ request: { headers } });
    response.headers.set("Cache-Control", "private, no-store");
    for (const cookie of updates)
      response.cookies.set(
        cookie.name,
        cookie.value,
        cookieOptions(new Date(Date.now() + cookie.days * 86400000)),
      );
    if (path === "/login" && request.nextUrl.searchParams.has("next")) {
      const target = safePricingReturn(
        request.nextUrl.searchParams.get("next"),
      );
      if (target !== "/cabinet")
        response.cookies.set(
          BILLING_RETURN_COOKIE,
          target,
          cookieOptions(new Date(Date.now() + 900000)),
        );
    }
    if (session?.renewed && token)
      response.cookies.set(SID, token, cookieOptions(session.expiresAt));
    return response;
  }
  if (isStudentProgressPath(path)) {
    try {
      await assertCanViewStudent(session?.user.id);
    } catch (error) {
      if (!(error instanceof ContentError) || error.status !== 404) throw error;
      return new NextResponse("Данные не найдены.", {
        status: 404,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "private, no-store",
        },
      });
    }
  }
  if (!session)
    return NextResponse.redirect(new URL("/login", getEnv().APP_URL));
  if (
    path.startsWith("/admin") &&
    !["ADMIN", "EDITOR"].includes(session.user.role)
  )
    return new NextResponse(authRu.forbidden, {
      status: 403,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  if (
    ([
      "/admin/users",
      "/admin/payments",
      "/admin/subscriptions",
      "/admin/settings",
      "/admin/integrations",
      "/admin/dashboard",
    ].some((p) => path === p || path.startsWith(p + "/")) &&
      session.user.role !== "ADMIN") ||
    (path.startsWith("/teacher") &&
      !["ADMIN", "EDITOR"].includes(session.user.role))
  )
    return new NextResponse(authRu.forbidden, {
      status: 403,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "private, no-store",
      },
    });
  const consent = await hasCurrentConsent(session.user);
  const response =
    !consent && path !== "/onboarding"
      ? NextResponse.redirect(new URL("/onboarding", getEnv().APP_URL))
      : NextResponse.next();
  response.headers.set("Cache-Control", "private, no-store");
  if (session.renewed && token)
    response.cookies.set(SID, token, cookieOptions(session.expiresAt));
  return response;
}
export const config = {
  matcher: [
    "/api/:path*",
    "/",
    "/demo",
    "/login",
    "/pricing",
    "/subjects/:path*",
    "/learn/:path*",
    "/cabinet/:path*",
    "/checkout/:path*",
    "/dev/mock-pay/:path*",
    "/onboarding",
    "/admin/:path*",
    "/review/:path*",
    "/tutor/:path*",
    "/teacher/:path*",
    "/student/:path*",
  ],
};
