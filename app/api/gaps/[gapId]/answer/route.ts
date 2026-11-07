import { assertOrigin, readInput } from "@/lib/auth/http";
import { contentJSON, contentFailure } from "@/lib/content/http";
import { lessonActor } from "@/lib/lessons/actor";
import { gapAnswerInput } from "@/lib/lessons/http";
import { answerGap } from "@/lib/lessons/service";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ gapId: string }> },
) {
  try {
    assertOrigin(request);
    const input = gapAnswerInput.parse(await readInput(request));
    const { gapId } = await params;
    return contentJSON(
      await answerGap(
        gapId,
        input.optionId ??
          (input.text !== undefined
            ? { text: input.text }
            : { optionIds: input.optionIds }),
        input.version,
        await lessonActor(),
        input.practice,
      ),
    );
  } catch (error) {
    return contentFailure(error);
  }
}
