import { getSetting } from "@/lib/settings";
import { NextRequest } from "next/server";
import { z } from "zod";
import { assertOrigin, readInput, clientIp } from "@/lib/auth/http";
import { contentJSON, contentFailure } from "@/lib/content/http";
import { consumeLimit } from "@/lib/access";
import { track } from "@/lib/analytics/events";
import { ANON_COOKIE, TOUCH_COOKIE, readTouch } from "@/lib/analytics/identity";
import { isToken, hashToken } from "@/lib/auth/crypto";
import { AuthError } from "@/lib/auth/errors";
import { ContentError } from "@/lib/content/errors";
import { getCurrentSession } from "@/lib/auth/server";
import { hasCurrentConsent } from "@/lib/auth/legal";
import { getDb } from "@/lib/db";
export async function POST(request: NextRequest) {
  try {
    assertOrigin(request);
    await consumeLimit(`events:${hashToken(clientIp(request))}`, {
      feature: "events",
      max: await getSetting("analytics.requestsPerMinute"),
      periodStart: new Date(Math.floor(Date.now() / 60000) * 60000),
    });
    const input = z
      .discriminatedUnion("name", [
        z
          .object({
            name: z.literal("landing_viewed"),
            requestId: z.uuid().optional(),
            props: z.object({}).strict(),
          })
          .strict(),
        z
          .object({
            name: z.literal("review_session_completed"),
            props: z.object({ startedAt: z.iso.datetime() }).strict(),
          })
          .strict(),
      ])
      .parse(await readInput(request));
    if (input.name === "landing_viewed") {
      const token = request.cookies.get(ANON_COOKIE)?.value;
      if (!isToken(token)) throw new AuthError("unauthorized", 401);
      const anonId = hashToken(token!);
      await track(
        input.name,
        { utm: readTouch(request.cookies.get(TOUCH_COOKIE)?.value) },
        { anonId },
        undefined,
        `landing:${anonId}:${input.requestId ?? new Date().toISOString().slice(0, 10)}`,
      );
    } else {
      const session = await getCurrentSession();
      if (!session || !(await hasCurrentConsent(session.user)))
        throw new AuthError("unauthorized", 401);
      const start = new Date(input.props.startedAt),
        now = new Date();
      if (start > now || start.getTime() < now.getTime() - 86400000)
        throw new ContentError("Сессия повторения истекла.", 422);
      const reviewed = await getDb().reviewLog.count({
        where: {
          card: { userId: session.userId },
          reviewedAt: { gte: start, lte: now },
        },
      });
      if (reviewed)
        await track(
          input.name,
          { reviewed },
          { userId: session.userId },
          undefined,
          `review:${session.userId}:${start.toISOString()}`,
        );
    }
    return contentJSON({ ok: true });
  } catch (e) {
    return contentFailure(e);
  }
}
