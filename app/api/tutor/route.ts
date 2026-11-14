import { assertOrigin, readInput } from "@/lib/auth/http";
import { contentJSON, contentFailure } from "@/lib/content/http";
import { lessonActor } from "@/lib/lessons/actor";
import { tutorInput, type TutorEvent } from "@/lib/tutor/types";
import {
  prepareTurn,
  executeTurn,
  failTurn,
  TutorLimitError,
  tutorError,
} from "@/lib/tutor/service";
import { getTutorQuota } from "@/lib/tutor/quota";
export const runtime = "nodejs";
export const maxDuration = 90;
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const input = tutorInput.parse(await readInput(request)),
      actor = await lessonActor(),
      turn = await prepareTurn(input, actor);
    const controller = new AbortController(),
      encoder = new TextEncoder();
    let closed = false;
    const abort = () => controller.abort();
    request.signal.addEventListener("abort", abort, { once: true });
    if (request.signal.aborted) controller.abort();
    const stream = new ReadableStream<Uint8Array>({
      async start(output) {
        const emit = (event: TutorEvent) => {
          if (!closed)
            output.enqueue(
              encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
            );
        };
        try {
          emit({
            type: "start",
            conversationId: turn.conversationId,
            quota: turn.quota,
          });
          const result = await executeTurn(
            turn,
            (text) => emit({ type: "delta", text }),
            controller.signal,
          );
          emit({ type: "done", ...result });
        } catch (error) {
          await failTurn(turn);
          const quota = await getTutorQuota(actor).catch(() => undefined);
          try {
            emit({ type: "error", error: tutorError(error), quota });
          } catch {}
        } finally {
          request.signal.removeEventListener("abort", abort);
          if (!closed) {
            closed = true;
            output.close();
          }
        }
      },
      cancel() {
        closed = true;
        controller.abort();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "private, no-store, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    if (error instanceof TutorLimitError)
      return contentJSON(
        { error: error.message, quota: error.quota },
        error.status,
      );
    return contentFailure(error);
  }
}
