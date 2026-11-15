export type DemoProfile = {
  index: number;
  name: string;
  email: string;
  kind: "excellent" | "average" | "lagging" | "dropout" | "new" | "repeated";
  score: number;
  lastDaysAgo: number;
  seed: number;
};
export function studentProfiles(seed = 1201): DemoProfile[] {
  let state = seed >>> 0;
  const random = () =>
    (state = (Math.imul(1664525, state) + 1013904223) >>> 0) / 4294967296;
  const kinds = [
    "excellent",
    "excellent",
    "average",
    "average",
    "average",
    "average",
    "lagging",
    "lagging",
    "dropout",
    "dropout",
    "new",
    "repeated",
  ] as const;
  const names = [
    "Астра Успешная",
    "Лира Успешная",
    "Вега Учебная",
    "Орион Учебный",
    "Альта Учебная",
    "Кедр Учебный",
    "Искра Начальная",
    "Луч Начальный",
    "Тучка Давняя",
    "Туман Давний",
    "Звезда Новая",
    "Комета Упорная",
  ];
  return kinds.map((kind, i) => ({
    index: i + 1,
    name: `Демо ${names[i]} (демо)`,
    email: `demo-student-${String(i + 1).padStart(2, "0")}@example.ru`,
    kind,
    score:
      kind === "excellent"
        ? 1
        : kind === "average"
          ? i % 2
            ? 0.8
            : 0.6
          : kind === "new"
            ? 0.8
            : 0.2,
    lastDaysAgo:
      kind === "dropout"
        ? 15 + Math.floor(random() * 10)
        : kind === "new"
          ? 1
          : kind === "lagging"
            ? 2
            : 0,
    seed: Math.floor(random() * 1000000),
  }));
}
export function studentPlan(profile: DemoProfile, topicCount: number) {
  const count =
    profile.kind === "excellent"
      ? topicCount
      : profile.kind === "average"
        ? Math.ceil(topicCount / 2)
        : profile.kind === "new"
          ? 1
          : Math.min(topicCount, (profile.index % 2) + 1);
  return Array.from({ length: count }, (_, i) => ({
    topicIndex: i,
    daysAgo:
      profile.lastDaysAgo +
      (count <= 1
        ? 0
        : Math.floor(
            ((count - i - 1) * (29 - profile.lastDaysAgo)) / (count - 1),
          )),
    score: profile.score,
    practiceRounds: profile.kind === "repeated" ? 6 : 0,
  }));
}
export function assertStudentPreview(
  databaseURL: string | undefined,
  nodeEnv: string | undefined,
) {
  if (
    nodeEnv === "production" ||
    !databaseURL ||
    !/^dental_preview_[a-f0-9]{12}$/.test(
      new URL(databaseURL).pathname.slice(1),
    )
  )
    throw new Error(
      "Demo students require a preview database and non-production NODE_ENV",
    );
}

export function demoStudentId(index: number) {
  return `preview-student-${String(index).padStart(2, "0")}`;
}

/** Round within the profile's band even when the quiz size is not a multiple of five. */
export function demoCorrectCount(profile: DemoProfile, questions: number) {
  const desired = Math.round(questions * profile.score);
  return profile.kind === "average"
    ? Math.min(
        Math.floor(questions * 0.8),
        Math.max(Math.ceil(questions * 0.6), desired),
      )
    : desired;
}
