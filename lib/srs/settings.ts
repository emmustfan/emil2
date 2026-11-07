import { getSetting } from "../settings";
export async function reviewSettings() {
  const keys = [
    "srs.hardMinutes",
    "srs.goodFirstDays",
    "srs.easyFirstDays",
    "srs.easeMin",
    "srs.hardEasePenalty",
    "srs.easyEaseGain",
    "srs.easyBonus",
    "srs.maxIntervalDays",
    "srs.newCardsPerDay",
    "srs.queuePageSize",
  ] as const;
  const values = await Promise.all(keys.map((key) => getSetting(key)));
  return {
    hardMinutes: values[0],
    goodFirstDays: values[1],
    easyFirstDays: values[2],
    easeMin: values[3],
    hardEasePenalty: values[4],
    easyEaseGain: values[5],
    easyBonus: values[6],
    maxIntervalDays: values[7],
    newCardsPerDay: values[8],
    queuePageSize: values[9],
  };
}
