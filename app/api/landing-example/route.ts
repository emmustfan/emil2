import { getSetting } from "@/lib/settings";
import { NextRequest } from "next/server";
import { z } from "zod";
import { assertOrigin, readInput, clientIp } from "@/lib/auth/http";
import { contentJSON, contentFailure } from "@/lib/content/http";
import { landingContent } from "@/lib/landing/content";
import { gradeAnswer } from "@/lib/exercises";
import { consumeLimit } from "@/lib/access";
import { hashToken } from "@/lib/auth/crypto";
import { ContentError } from "@/lib/content/errors";
import { submissionSchema } from "@/lib/demo/flow";
export async function POST(request: NextRequest) {
  try {
    assertOrigin(request);
    await consumeLimit(`ip:${hashToken(clientIp(request))}`, {
      feature: "example",
      max: await getSetting("demo.exampleRequestsPerMinute"),
      periodStart: new Date(Math.floor(Date.now() / 60000) * 60000),
    });
    const input = z
      .discriminatedUnion("action", [
        z
          .object({
            action: z.literal("answer"),
            id: z.string().max(100),
            submission: submissionSchema,
          })
          .strict(),
        z.object({ action: z.literal("reveal") }).strict(),
      ])
      .parse(await readInput(request));
    const content = await landingContent();
    if (input.action === "reveal")
      return contentJSON({
        answer: content.examples[0].options
          .filter((o) => content.examples[0].correctOptionIds.includes(o.id))
          .map((o) => o.text)
          .join("; "),
      });
    const example = content.examples.find((e) => e.id === input.id);
    if (!example) throw new ContentError("Пример не найден.", 404);
    let graded;
    try {
      graded = gradeAnswer(example, input.submission);
    } catch {
      throw new ContentError("Выберите допустимый ответ.", 422);
    }
    return contentJSON({
      correct: graded.isCorrect,
      chosenValues: graded.chosenValues,
      correctValues: graded.correctValues,
      explanation: example.explanation,
    });
  } catch (e) {
    return contentFailure(e);
  }
}
