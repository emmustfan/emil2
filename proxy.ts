import { BILLING_RETURN_COOKIE } from "./lib/billing/http";
import { safePricingReturn } from "./lib/billing/policy";
import { NextRequest, NextResponse } from "next/server";
import { findSession, SID, cookieOptions } from "./lib/auth/session";
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
  const session = await findSession(token, true);
  const path = request.nextUrl.pathname;
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
    ((path.startsWith("/admin/users") || path.startsWith("/admin/payments")) &&
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
