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
  answerType: z
    .enum(["SINGLE_CHOICE", "MULTIPLE_CHOICE", "SHORT_TEXT"])
    .default("SINGLE_CHOICE"),
  options: z.array(z.object({ id: z.string(), text: z.string() })),
  correctOptionIds: z.array(z.string()),
  acceptedAnswers: z.array(z.string()).default([]),
});
export function snapshotReader(revisions: TopicRevision[]) {
  const snapshots = new Map(
    revisions.map((r) => [
      `${r.topicId}:${r.version}`,
      {
        parsed: parseTopic(r.contentMd),
        exercises: gapExercisesSchema.parse(r.gapExercises),
        questions: z.array(question).safeParse(r.questions).data ?? [],
      },
    ]),
  );
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
      const snapshot = snapshots.get(`${g.topicId}:${version}`),
        source = snapshot?.parsed.gaps.find((p) => p.gapKey === g.gapKey);
      if (!snapshot || !source)
        return { sentence: g.sentence, correct: [] as string[] };
      const definition = gapDefinition(
        source,
        gapExerciseFor(snapshot.exercises, source.gapKey),
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
          : snapshots
              .get(`${q.topicId}:${version}`)
              ?.questions.find((item) => item.id === q.id);
      if (!source)
        return {
          stem: q.stem,
          options: optionsFromJSON(q.options),
          correct: [] as string[],
        };
      const options = optionsFromJSON(source.options);
      return {
        stem: source.stem,
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
