import type { GapExercises } from "../exercises";
import { normalizeAnswer, normalizeChoice, gapExerciseFor } from "../exercises";
import { ContentError } from "./errors";
import { parseTopic, makeGapKey, MAX_MARKDOWN_CHARS } from "./parse";
import { gapSourceWithId, randomGapId } from "./gap-id";

type ExistingIdentities = ReadonlySet<string> | ReadonlyMap<string, string>;

/** Preserve old API clients that still submit legacy markup after IDs were assigned. */
export function existingGapIdentities(
  rows: { gapKey: string; sentence: string; answer: string }[],
) {
  const result = new Map(rows.map((gap) => [gap.gapKey, gap.gapKey]));
  const aliases = new Map<string, string | null>();
  for (const gap of rows) {
    const legacy = makeGapKey(gap.sentence, gap.answer);
    aliases.set(
      legacy,
      aliases.has(legacy) && aliases.get(legacy) !== gap.gapKey
        ? null
        : gap.gapKey,
    );
  }
  for (const [hash, id] of aliases)
    if (id && !result.has(hash)) result.set(hash, id);
  return result;
}

function normalize(
  contentMd: string,
  gapExercises: GapExercises,
  existingKeys: ExistingIdentities,
  generate?: () => string,
) {
  const parsed = parseTopic(contentMd),
    used = new Set<string>(),
    reserved = new Set([
      ...Object.keys(gapExercises),
      ...existingKeys.values(),
      ...parsed.gaps.flatMap((gap) => (gap.explicitId ? [gap.explicitId] : [])),
    ]),
    exercises = { ...gapExercises },
    replacements: { start: number; end: number; source: string }[] = [];
  const freshId = () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const id = generate!();
      if (!used.has(id) && !reserved.has(id)) return id;
    }
    throw new ContentError(
      "Не удалось создать ID пропуска. Повторите сохранение.",
    );
  };
  for (const gap of parsed.gaps) {
    const legacyId =
      "get" in existingKeys
        ? existingKeys.get(gap.gapKey)
        : existingKeys.has(gap.gapKey)
          ? gap.gapKey
          : undefined;
    let id = gap.explicitId ?? legacyId;
    if ((!id || used.has(id)) && generate) id = freshId();
    if (!id || used.has(id)) continue;
    used.add(id);
    const config = gapExerciseFor(gapExercises, gap.gapKey);
    if (config) exercises[id] = config;
    if (id !== gap.explicitId)
      replacements.push({
        start: gap.start,
        end: gap.end,
        source: gapSourceWithId(contentMd.slice(gap.start, gap.end), id),
      });
  }
  for (const change of replacements.sort((a, b) => b.start - a.start))
    contentMd =
      contentMd.slice(0, change.start) +
      change.source +
      contentMd.slice(change.end);
  return { contentMd, gapExercises: exercises };
}

/** Read-only compatibility view: pin existing legacy gaps BEFORE editing context. */
export function pinLegacyGapIds(
  contentMd: string,
  exercises: GapExercises,
  existingKeys: ExistingIdentities,
) {
  return normalize(contentMd, exercises, existingKeys);
}

/** Lazy migration on save/import; no SQL migration and no changes to learner rows. */
export function stabilizeGapIds(
  contentMd: string,
  exercises: GapExercises = {},
  existingKeys: ExistingIdentities = new Set(),
  generate = randomGapId,
) {
  const result = normalize(contentMd, exercises, existingKeys, generate);
  if (result.contentMd.length > MAX_MARKDOWN_CHARS)
    throw new ContentError(
      "Материал слишком большой после добавления ID пропусков: разделите его на несколько тем.",
    );
  return result;
}

type GapAnswers = {
  answerType: string;
  answer: string;
  correctAnswers: string[];
  acceptedAnswers: string[];
};
export function correctGapAnswersChanged(
  before: GapAnswers,
  after: GapAnswers,
) {
  const answers = (gap: GapAnswers) => {
    const text = gap.answerType === "SHORT_TEXT";
    const values = text ? gap.acceptedAnswers : gap.correctAnswers;
    return [
      ...new Set(
        (values.length ? values : [gap.answer]).map(
          text ? normalizeAnswer : normalizeChoice,
        ),
      ),
    ].sort();
  };
  return (
    before.answerType !== after.answerType ||
    JSON.stringify(answers(before)) !== JSON.stringify(answers(after))
  );
}
