import { z } from "zod";
export const DEFAULT_SETTINGS = {
  "analytics.requestsPerMinute": 30,
  "demo.exampleRequestsPerMinute": 30,
  "srs.hardMinutes": 10,
  "srs.hardEasePenalty": 0.2,
  "srs.easyEaseGain": 0.15,
  "srs.queuePageSize": 20,
  "srs.goodFirstDays": 1,
  "srs.easyFirstDays": 3,
  "srs.easeDefault": 2.5,
  "srs.easeMin": 1.3,
  "srs.easyBonus": 1.3,
  "srs.maxIntervalDays": 180,
  "srs.newCardsPerDay": 30,
  "tutor.demoLimit": 5,
  "tutor.freeDailyLimit": 15,
  "tutor.paidDailyLimit": 150,
  "tutor.topK": 6,
  "tutor.maxQuestionChars": 1000,
  "tutor.requestsPerMinute": 10,
  "tutor.timeoutMs": 60000,
  "tutor.leaseGraceMs": 10000,
  "tutor.historyMessages": 6,
  "tutor.maxTokens": 1200,
  "tutor.maxAnswerChars": 12000,
  "tutor.minSimilarity": 0.15,
  "tutor.topicBonus": 0.1,
  "tutor.candidateMultiplier": 4,
  "tutor.chunkTargetTokens": 500,
  "tutor.chunkMaxTokens": 800,
  "tutor.embeddingBatchSize": 16,
  "lesson.passThreshold": 0.7,
  "lesson.requestsPerMinute": 120,
  "lesson.guestDays": 30,
  "lesson.paywallPreviewBlocks": 2,
  "billing.renewalLeadHours": 24,
  "billing.creationTtlHours": 23,
  "billing.returnPollSeconds": 30,
  "billing.requestsPerMinute": 10,
  "billing.webhookRequestsPerMinute": 120,
  "billing.graceDays": 3,
  "billing.retryHours": [24, 72],
  "billing.reminderDaysBefore": 3,
  "demo.discountStepPercent": 5,
  "demo.discountMaxPercent": 20,
  "demo.discountTtlHours": 72,
  "exam.secondsPerQuestion": 60,
  "exam.passThreshold": 0.7,
  "auth.sessionDays": 30,
  "auth.maxSessions": 5,
  "auth.refreshHours": 24,
  "auth.tokenMinutes": 15,
  "auth.emailWindowMinutes": 15,
  "auth.emailMaxRequests": 3,
  "auth.ipWindowMinutes": 60,
  "auth.ipMaxRequests": 10,
  "auth.resendSeconds": 60,
  "auth.telegramMaxAgeSeconds": 86400,
  "content.pageSize": 20,
  "content.minQuestions": 5,
  "content.maxQuestions": 15,
  "content.autosaveMs": 1000,
  "content.imageMaxBytes": 5242880,
  "content.imageMaxPixels": 20000000,
  "content.imageMaxSide": 2400,
  "content.imagesPerTopic": 30,
  "content.imageRequestsPerMinute": 10,
  "import.maxBytes": 20971520,
  "import.maxTextChars": 60000,
  "import.partChars": 12000,
  "import.maxParts": 5,
  "import.requestsPerHour": 5,
  "import.maxConcurrent": 2,
  "admin.usersPageSize": 20,
  "admin.maxTeacherSubjects": 200,
  "admin.maxGrantDays": 3650,
  "admin.defaultGrantDays": 30,
};
export type SettingKey = keyof typeof DEFAULT_SETTINGS;
export function decodeSetting<K extends SettingKey>(
  key: K,
  value: unknown,
): (typeof DEFAULT_SETTINGS)[K] {
  const fallback = DEFAULT_SETTINGS[key];
  const schema = Array.isArray(fallback)
    ? z.array(z.number().positive()).min(1).max(10)
    : key.endsWith("Threshold") ||
        key === "tutor.minSimilarity" ||
        key === "tutor.topicBonus"
      ? z.number().min(0).max(1)
      : z
          .number()
          .positive()
          .max(
            key === "import.maxBytes"
              ? 20971520
              : key === "content.imageMaxBytes"
                ? 10485760
                : key === "content.imageMaxPixels"
                  ? 40000000
                  : 100000,
          );
  const result = schema.safeParse(value);
  // Bounds for security settings; avoid fractional session counts and unbounded cookies.
  if (
    !result.success ||
    (key === "import.maxTextChars" &&
      typeof result.data === "number" &&
      result.data > 60000) ||
    (key === "import.partChars" &&
      typeof result.data === "number" &&
      (result.data < 2000 || result.data > 12000)) ||
    (key === "import.maxConcurrent" &&
      typeof result.data === "number" &&
      result.data > 2) ||
    (key === "import.maxParts" &&
      typeof result.data === "number" &&
      result.data > 5) ||
    (key === "import.requestsPerHour" &&
      typeof result.data === "number" &&
      result.data > 20) ||
    (key === "content.imageMaxSide" &&
      typeof result.data === "number" &&
      (result.data < 64 || result.data > 4096)) ||
    (key === "content.imagesPerTopic" &&
      typeof result.data === "number" &&
      result.data > 100) ||
    (key === "billing.renewalLeadHours" &&
      typeof result.data === "number" &&
      result.data > 24) ||
    (key === "billing.creationTtlHours" &&
      typeof result.data === "number" &&
      result.data > 23) ||
    (((key.startsWith("billing.") && key !== "billing.retryHours") ||
      key.startsWith("analytics.") ||
      key === "demo.exampleRequestsPerMinute" ||
      key.startsWith("admin.") ||
      key.startsWith("import.") ||
      key.startsWith("content.") ||
      key === "srs.newCardsPerDay" ||
      key === "srs.queuePageSize" ||
      (key.startsWith("lesson.") && !key.endsWith("Threshold"))) &&
      (typeof result.data !== "number" || !Number.isInteger(result.data))) ||
    (key === "srs.queuePageSize" &&
      typeof result.data === "number" &&
      result.data > 100) ||
    (key === "admin.usersPageSize" &&
      typeof result.data === "number" &&
      result.data > 100) ||
    (key === "admin.maxTeacherSubjects" &&
      typeof result.data === "number" &&
      result.data > 1000) ||
    (["admin.maxGrantDays", "admin.defaultGrantDays"].includes(key) &&
      typeof result.data === "number" &&
      result.data > 3650) ||
    (key.startsWith("tutor.") &&
      !["tutor.minSimilarity", "tutor.topicBonus"].includes(key) &&
      (typeof result.data !== "number" || !Number.isInteger(result.data))) ||
    (key === "tutor.maxQuestionChars" &&
      typeof result.data === "number" &&
      result.data > 1000) ||
    (key === "tutor.timeoutMs" &&
      typeof result.data === "number" &&
      result.data > 60000) ||
    (key === "tutor.topK" &&
      typeof result.data === "number" &&
      result.data > 20) ||
    (["tutor.chunkTargetTokens", "tutor.chunkMaxTokens"].includes(key) &&
      typeof result.data === "number" &&
      (result.data < 300 || result.data > 800)) ||
    (key === "tutor.embeddingBatchSize" &&
      typeof result.data === "number" &&
      result.data > 64) ||
    (key === "tutor.historyMessages" &&
      typeof result.data === "number" &&
      result.data > 6) ||
    (key === "lesson.guestDays" &&
      typeof result.data === "number" &&
      result.data > 365) ||
    (key.startsWith("auth.") &&
      (typeof result.data !== "number" ||
        !Number.isInteger(result.data) ||
        result.data > (key === "auth.telegramMaxAgeSeconds" ? 86400 : 365)))
  )
    return fallback;
  return result.data as (typeof DEFAULT_SETTINGS)[K];
}
