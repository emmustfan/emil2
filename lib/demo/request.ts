import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import {
  ANON_COOKIE,
  DEMO_COOKIE,
  TOUCH_COOKIE,
  readTouch,
} from "../analytics/identity";
import { GUEST_COOKIE, guestDemo } from "../lessons/actor";
import { getCurrentSession } from "../auth/server";
import { getDb } from "../db";
import { AuthError } from "../auth/errors";
export function visitFrom(request: NextRequest) {
  return {
    demoToken:
      request.cookies.get(DEMO_COOKIE)?.value ??
      request.cookies.get(GUEST_COOKIE)?.value,
    anonToken: request.cookies.get(ANON_COOKIE)?.value,
    touch: request.cookies.get(TOUCH_COOKIE)?.value,
  };
}
export async function currentDemo() {
  if (await getCurrentSession()) throw new AuthError("forbidden", 403);
  const jar = await cookies();
  const demo = await guestDemo(
    jar.get(DEMO_COOKIE)?.value ?? jar.get(GUEST_COOKIE)?.value,
  );
  if (!demo.utm)
    await getDb().demoSession.updateMany({
      where: { id: demo.id, userId: null },
      data: { utm: readTouch(jar.get(TOUCH_COOKIE)?.value) },
    });
  return demo;
}
