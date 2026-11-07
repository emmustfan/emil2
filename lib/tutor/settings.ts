import { getSetting } from "../settings";
import {
  DEFAULT_SETTINGS,
  decodeSetting,
  type SettingKey,
} from "../settings/defaults";
import { getDb } from "../db";
export async function tutorSettings(direct = false) {
  const rows = direct ? await getDb().appSetting.findMany() : [];
  const entries = await Promise.all(
    (Object.keys(DEFAULT_SETTINGS) as SettingKey[])
      .filter((key) => key.startsWith("tutor."))
      .map(
        async (key) =>
          [
            key.slice(6),
            direct
              ? decodeSetting(key, rows.find((r) => r.key === key)?.value)
              : await getSetting(key),
          ] as const,
      ),
  );
  const settings = Object.fromEntries(entries) as Record<
    | "demoLimit"
    | "freeDailyLimit"
    | "paidDailyLimit"
    | "topK"
    | "maxQuestionChars"
    | "requestsPerMinute"
    | "timeoutMs"
    | "leaseGraceMs"
    | "historyMessages"
    | "maxTokens"
    | "maxAnswerChars"
    | "minSimilarity"
    | "topicBonus"
    | "candidateMultiplier"
    | "chunkTargetTokens"
    | "chunkMaxTokens"
    | "embeddingBatchSize",
    number
  >;
  settings.chunkTargetTokens = Math.min(
    settings.chunkTargetTokens,
    settings.chunkMaxTokens,
  );
  return settings;
}
export type TutorSettings = Awaited<ReturnType<typeof tutorSettings>>;
