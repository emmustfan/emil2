import { getDb } from "../db";
import { hasAccess } from "../access";
import { lockTopicForLearning } from "../content/locks";
import { lockLearningActor } from "./actor";
import { publishedTopic } from "./service";
import { ContentError } from "../content/errors";
export async function gapHistory(topicId: string, userId: string) {
  return getDb().$transaction(async (db) => {
    await lockLearningActor(db, { userId });
    await lockTopicForLearning(db, topicId);
    const topic = await publishedTopic(topicId, db);
    if (!(await hasAccess(userId, topic, db)))
      throw new ContentError("Данные не найдены.", 404);
    const gaps = await db.gap.findMany({
      where: { topicId },
      select: { id: true, sentence: true },
    });
    const attempts = await db.gapAttempt.findMany({
      where: { userId, gapId: { in: gaps.map((g) => g.id) } },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });
    // No answer keys or other people's records are included, even after a publication changes the key.
    return attempts.map((a) => ({
      id: a.id,
      sentence: gaps.find((g) => g.id === a.gapId)!.sentence,
      chosen: a.chosenValues,
      text: a.chosenText,
      correct: a.isCorrect,
      practice: a.practice,
      version: a.topicVersion,
      at: a.createdAt.toISOString(),
    }));
  });
}
export type GapHistory = Awaited<ReturnType<typeof gapHistory>>;
