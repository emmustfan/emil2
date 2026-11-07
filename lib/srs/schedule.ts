export type Rating = "HARD" | "GOOD" | "EASY";
export type CardState = "NEW" | "LEARNING" | "REVIEW";
export type ScheduleCard = {
  state: CardState;
  intervalDays: number;
  ease: number;
  reps: number;
  lapses: number;
};
export type ScheduleSettings = {
  hardMinutes: number;
  goodFirstDays: number;
  easyFirstDays: number;
  easeMin: number;
  hardEasePenalty: number;
  easyEaseGain: number;
  easyBonus: number;
  maxIntervalDays: number;
};
export function schedule(
  card: ScheduleCard,
  rating: Rating,
  now: Date,
  settings: ScheduleSettings,
) {
  if (
    !Number.isFinite(now.getTime()) ||
    Object.values(settings).some((v) => !Number.isFinite(v) || v <= 0) ||
    !Number.isFinite(card.ease) ||
    card.ease <= 0 ||
    !Number.isFinite(card.intervalDays) ||
    card.intervalDays < 0 ||
    ![card.reps, card.lapses].every((v) => Number.isInteger(v) && v >= 0) ||
    !["NEW", "LEARNING", "REVIEW"].includes(card.state) ||
    !["HARD", "GOOD", "EASY"].includes(rating)
  )
    throw new Error("Invalid scheduling input");
  let ease = Math.max(settings.easeMin, card.ease),
    intervalDays = card.intervalDays,
    lapses = card.lapses;
  let state: CardState = "REVIEW";
  if (rating === "HARD") {
    if (card.state === "REVIEW") lapses++;
    ease = Math.max(settings.easeMin, ease - settings.hardEasePenalty);
    intervalDays = 0;
    state = "LEARNING";
  } else if (rating === "GOOD")
    intervalDays =
      intervalDays < 1
        ? settings.goodFirstDays
        : Math.round(intervalDays * ease);
  else {
    intervalDays =
      intervalDays < 1
        ? settings.easyFirstDays
        : Math.round(intervalDays * ease * settings.easyBonus);
    ease += settings.easyEaseGain;
  }
  intervalDays = Math.min(settings.maxIntervalDays, intervalDays);
  return {
    state,
    ease,
    intervalDays,
    lapses,
    reps: card.reps + 1,
    dueAt: new Date(
      now.getTime() +
        (rating === "HARD"
          ? settings.hardMinutes * 60000
          : intervalDays * 86400000),
    ),
  };
}
export function intervalLabel(
  rating: Rating,
  result: ReturnType<typeof schedule>,
  settings: ScheduleSettings,
) {
  const value = rating === "HARD" ? settings.hardMinutes : result.intervalDays;
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)} ${rating === "HARD" ? "мин" : "дн"}`;
}
