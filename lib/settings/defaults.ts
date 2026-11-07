import { z } from "zod";
export const DEFAULT_SETTINGS = {
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
  "lesson.passThreshold": 0.7,
  "lesson.requestsPerMinute": 120,
  "lesson.guestDays": 30,
  "lesson.paywallPreviewBlocks": 2,
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
};
export type SettingKey = keyof typeof DEFAULT_SETTINGS;
export function decodeSetting<K extends SettingKey>(
  key: K,
  value: unknown,
): (typeof DEFAULT_SETTINGS)[K] {
  const fallback = DEFAULT_SETTINGS[key];
  const schema = Array.isArray(fallback)
    ? z.array(z.number().positive()).min(1).max(10)
    : key.endsWith("Threshold")
      ? z.number().min(0).max(1)
      : z.number().positive().max(100000);
  const result = schema.safeParse(value);
  // Bounds for security settings; avoid fractional session counts and unbounded cookies.
  if (
    !result.success ||
    ((key.startsWith("content.") ||
      key === "srs.newCardsPerDay" ||
      key === "srs.queuePageSize" ||
      (key.startsWith("lesson.") && !key.endsWith("Threshold"))) &&
      (typeof result.data !== "number" || !Number.isInteger(result.data))) ||
    (key === "srs.queuePageSize" &&
      typeof result.data === "number" &&
      result.data > 100) ||
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
