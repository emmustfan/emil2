import { assertOrigin, readInput } from "@/lib/auth/http";
import { contentJSON, contentFailure } from "@/lib/content/http";
import { lessonActor } from "@/lib/lessons/actor";
import { testStartInput } from "@/lib/lessons/http";
import { startTest } from "@/lib/lessons/service";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ topicId: string }> },
) {
  try {
    assertOrigin(request);
    const input = testStartInput.parse(await readInput(request));
    return contentJSON(
      await startTest(
        (await params).topicId,
        input.version,
        await lessonActor(),
      ),
    );
  } catch (error) {
    return contentFailure(error);
  }
}
