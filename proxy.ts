import { NextRequest, NextResponse } from "next/server";
import { findSession, SID, cookieOptions } from "./lib/auth/session";
import { hasCurrentConsent } from "./lib/auth/legal";
import { getEnv } from "./lib/env";
import { newToken, isToken } from "./lib/auth/crypto";
import { GUEST_COOKIE } from "./lib/lessons/actor";
import { getSetting } from "./lib/settings";
import { authRu } from "./lib/i18n/ru";
export async function proxy(request: NextRequest) {
  const token = request.cookies.get(SID)?.value;
  const session = await findSession(token, true);
  if (request.nextUrl.pathname.startsWith("/learn/")) {
    if (session && !(await hasCurrentConsent(session.user)))
      return NextResponse.redirect(new URL("/onboarding", getEnv().APP_URL));
    const headers = new Headers(request.headers);
    let guest = request.cookies.get(GUEST_COOKIE)?.value;
    const createGuest = !session && !isToken(guest);
    if (createGuest) {
      guest = newToken();
      request.cookies.set(GUEST_COOKIE, guest);
      headers.set("cookie", request.cookies.toString());
    }
    const response = NextResponse.next({ request: { headers } });
    response.headers.set("Cache-Control", "private, no-store");
    if (createGuest && guest)
      response.cookies.set(
        GUEST_COOKIE,
        guest,
        cookieOptions(
          new Date(
            Date.now() + (await getSetting("lesson.guestDays")) * 86400000,
          ),
        ),
      );
    if (session?.renewed && token)
      response.cookies.set(SID, token, cookieOptions(session.expiresAt));
    return response;
  }
  if (!session)
    return NextResponse.redirect(new URL("/login", getEnv().APP_URL));
  const path = request.nextUrl.pathname;
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
    (path.startsWith("/admin/users") && session.user.role !== "ADMIN") ||
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
    "/learn/:path*",
    "/cabinet/:path*",
    "/onboarding",
    "/admin/:path*",
    "/review/:path*",
    "/tutor/:path*",
    "/teacher/:path*",
    "/student/:path*",
  ],
};
