import { getCurrentSession } from "@/lib/auth/server";
import { requestAccountDeletion } from "@/lib/auth/deletion";
import { assertOrigin, readInput } from "@/lib/auth/http";
import { AuthError } from "@/lib/auth/errors";
import { contentJSON, contentFailure } from "@/lib/content/http";
import { SID } from "@/lib/auth/session";
import { z } from "zod";
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const session = await getCurrentSession();
    if (!session) throw new AuthError("unauthorized", 401);
    z.object({ confirm: z.literal("УДАЛИТЬ") })
      .strict()
      .parse(await readInput(request));
    await requestAccountDeletion(session.userId);
    const response = contentJSON({ ok: true });
    for (const name of [
      SID,
      "demo_sid",
      "lesson_guest",
      "anon_id",
      "first_touch",
      "billing_return",
    ])
      response.cookies.delete(name);
    return response;
  } catch (e) {
    return contentFailure(e);
  }
}
