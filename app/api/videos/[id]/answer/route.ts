import { assertOrigin, readInput } from "@/lib/auth/http";
import { contentFailure, contentJSON } from "@/lib/content/http";
import { lessonActor } from "@/lib/lessons/actor";
import { videoAnswerInput, answerVideoQuestion } from "@/lib/video/progress";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertOrigin(request);
    return contentJSON(
      await answerVideoQuestion(
        await lessonActor(),
        (await params).id,
        videoAnswerInput.parse(await readInput(request)),
      ),
    );
  } catch (error) {
    return contentFailure(error);
  }
}
