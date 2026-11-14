import { z } from "zod";
import { assertOrigin, readInput } from "@/lib/auth/http";
import { contentJSON, contentFailure } from "@/lib/content/http";
import { lessonActor } from "@/lib/lessons/actor";
import { setFeedback } from "@/lib/tutor/service";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ messageId: string }> },
) {
  try {
    assertOrigin(request);
    const input = z
        .object({ value: z.union([z.literal(1), z.literal(-1)]) })
        .strict()
        .parse(await readInput(request)),
      { messageId } = await params;
    z.string()
      .regex(/^[a-zA-Z0-9_-]{1,128}$/)
      .parse(messageId);
    return contentJSON(
      await setFeedback(await lessonActor(), messageId, input.value),
    );
  } catch (error) {
    return contentFailure(error);
  }
}
