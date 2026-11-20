import { z } from "zod";
import { parseTopic } from "../content/parse";
import {
  gapDefinition,
  gapExerciseFor,
  gapExercisesSchema,
} from "../exercises";
import type { Gap, Question, TopicRevision } from "../generated/prisma/client";
import { optionsFromJSON } from "../lessons/public";
const question = z.object({
  id: z.string(),
  stem: z.string(),
  videoId: z.string().nullable().optional(),
  answerType: z
    .enum(["SINGLE_CHOICE", "MULTIPLE_CHOICE", "SHORT_TEXT"])
    .default("SINGLE_CHOICE"),
  options: z.array(z.object({ id: z.string(), text: z.string() })),
  correctOptionIds: z.array(z.string()),
  acceptedAnswers: z.array(z.string()).default([]),
});
function parseSnapshot(revision: TopicRevision) {
  return {
    parsed: parseTopic(revision.contentMd),
    exercises: gapExercisesSchema.parse(revision.gapExercises),
    questions: z.array(question).safeParse(revision.questions).data ?? [],
  };
}

export function snapshotReader(revisions: TopicRevision[]) {
  const byVersion = new Map(
    revisions.map((r) => [`${r.topicId}:${r.version}`, r]),
  );
  const parsed = new Map<string, ReturnType<typeof parseSnapshot>>();
  function snapshot(topicId: string, version: number | null) {
    const key = `${topicId}:${version}`;
    const cached = parsed.get(key);
    if (cached) return cached;
    const revision = byVersion.get(key);
    if (!revision) return null;
    const result = parseSnapshot(revision);
    parsed.set(key, result);
    return result;
  }
  return {
    gap(g: Gap, version: number, currentVersion: number) {
      if (version === currentVersion)
        return {
          sentence: g.sentence,
          correct:
            g.answerType === "SHORT_TEXT"
              ? g.acceptedAnswers.length
                ? g.acceptedAnswers
                : [g.answer]
              : g.correctAnswers.length
                ? g.correctAnswers
                : [g.answer],
        };
      const previous = snapshot(g.topicId, version),
        source = previous?.parsed.gaps.find((p) => p.gapKey === g.gapKey);
      if (!previous || !source)
        return { sentence: g.sentence, correct: [] as string[] };
      const definition = gapDefinition(
        source,
        gapExerciseFor(previous.exercises, source.gapKey),
      );
      return {
        sentence: source.sentence,
        correct:
          definition.answerType === "SHORT_TEXT"
            ? definition.acceptedAnswers
            : definition.options
                .filter((o) => definition.correctOptionIds.includes(o.id))
                .map((o) => o.text),
      };
    },
    question(q: Question, version: number | null, currentVersion: number) {
      const source =
        version === currentVersion
          ? q
          : snapshot(q.topicId, version)?.questions.find(
              (item) => item.id === q.id,
            );
      if (!source)
        return {
          stem: q.stem,
          videoId: q.videoId,
          options: optionsFromJSON(q.options),
          correct: [] as string[],
        };
      const options = optionsFromJSON(source.options);
      return {
        stem: source.stem,
        videoId: source.videoId === undefined ? q.videoId : source.videoId,
        options,
        correct:
          source.answerType === "SHORT_TEXT"
            ? source.acceptedAnswers
            : options
                .filter((o) => source.correctOptionIds.includes(o.id))
                .map((o) => o.text),
      };
    },
  };
}
