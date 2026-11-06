import { assertOrigin, readInput } from "@/lib/auth/http";
import { contentJSON, contentFailure } from "@/lib/content/http";
import { lessonActor } from "@/lib/lessons/actor";
import { testAnswerInput } from "@/lib/lessons/http";
import { answerQuestion } from "@/lib/lessons/service";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ topicId: string }> },
) {
  try {
    assertOrigin(request);
    const input = testAnswerInput.parse(await readInput(request));
    return contentJSON(
      await answerQuestion(
        (await params).topicId,
        input.runId,
        input.questionId,
        input.chosenId,
        await lessonActor(),
      ),
    );
  } catch (error) {
    return contentFailure(error);
  }
}
