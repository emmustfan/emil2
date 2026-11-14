import { getDb } from "../db";
import type { Prisma } from "../generated/prisma/client";
import { hasAccess } from "../access";
import { AuthError } from "../auth/errors";
import { ContentError } from "../content/errors";
import { lock } from "../auth/session";
import { optionsFromJSON } from "../lessons/public";
import { lessonHref } from "../lessons/catalog";
import { dayWindow } from "./day";
import { reviewSettings } from "./settings";
import { schedule, intervalLabel, type Rating } from "./schedule";
import { gapContext } from "./context";
import type {
  ReviewSummary,
  ReviewFront,
  ReviewBack,
  ReviewQueue,
} from "./types";
type Db = Prisma.TransactionClient;
const order = [{ dueAt: "asc" as const }, { id: "asc" as const }];
const introduced: Prisma.CardWhereInput = {
  OR: [{ state: { not: "NEW" } }, { firstShownAt: { not: null } }],
};
const fresh: Prisma.CardWhereInput = { state: "NEW", firstShownAt: null };
async function validUser(userId: string, db: Db = getDb()) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, timezone: true, blockedAt: true, deletedAt: true },
  });
  if (!user || user.blockedAt || user.deletedAt)
    throw new AuthError("unauthorized", 401);
  return user;
}
async function eligible(userId: string): Promise<Prisma.CardWhereInput> {
  const subjects = await getDb().subject.findMany({
    where: { status: "PUBLISHED" },
    select: { id: true },
  });
  const open = await Promise.all(
    subjects.map(async (s) =>
      (await hasAccess(userId, { subjectId: s.id, isFree: false }))
        ? s.id
        : null,
    ),
  );
  return {
    userId,
    suspended: false,
    topic: {
      status: "PUBLISHED",
      subject: { status: "PUBLISHED" },
      OR: [
        { isFree: true },
        { subjectId: { in: open.filter((id): id is string => !!id) } },
      ],
    },
    OR: [
      { source: "GAP", gap: { is: { archivedAt: null } } },
      { source: "QUESTION", question: { is: { archivedAt: null } } },
    ],
  };
}
async function queueState(userId: string, now: Date) {
  const user = await validUser(userId),
    settings = await reviewSettings(),
    window = dayWindow(now, user.timezone),
    where = await eligible(userId),
    db = getDb();
  const [shown, oldDue, newDue, reviewed, futureOld, futureNew] =
    await Promise.all([
      db.card.count({
        where: { userId, firstShownAt: { gte: window.start, lt: window.end } },
      }),
      db.card.count({
        where: { AND: [where, introduced, { dueAt: { lte: now } }] },
      }),
      db.card.count({
        where: { AND: [where, fresh, { dueAt: { lte: now } }] },
      }),
      db.reviewLog.count({
        where: {
          card: { userId },
          reviewedAt: { gte: window.start, lt: window.end },
        },
      }),
      db.card.aggregate({
        where: { AND: [where, introduced, { dueAt: { gt: now } }] },
        _min: { dueAt: true },
      }),
      db.card.aggregate({
        where: { AND: [where, fresh, { dueAt: { gt: now } }] },
        _min: { dueAt: true },
      }),
    ]);
  const remaining = Math.max(0, settings.newCardsPerDay - shown),
    waiting = Math.max(0, newDue - remaining);
  const next = [
    futureOld._min.dueAt,
    futureNew._min.dueAt
      ? new Date(
          Math.max(
            futureNew._min.dueAt.getTime(),
            remaining ? 0 : window.end.getTime(),
          ),
        )
      : null,
    waiting ? window.end : null,
  ]
    .filter((d): d is Date => !!d)
    .sort((a, b) => a.getTime() - b.getTime())[0];
  const summary: ReviewSummary = {
    dueCount: oldDue + Math.min(newDue, remaining),
    reviewedToday: reviewed,
    newShownToday: shown,
    newDailyLimit: settings.newCardsPerDay,
    newWaiting: waiting,
    nextDueAt: next?.toISOString() ?? null,
    timeZone: window.timeZone,
  };
  return { where, settings, summary, remaining };
}
export async function getReviewSummary(userId: string, now = new Date()) {
  return (await queueState(userId, now)).summary;
}
const frontSelect = {
  id: true,
  revision: true,
  source: true,
  dueAt: true,
  topicId: true,
  gap: { select: { sentence: true, topicId: true } },
  question: { select: { stem: true, topicId: true } },
  topic: {
    select: {
      version: true,
      title: true,
      subject: { select: { title: true } },
    },
  },
} as const satisfies Prisma.CardSelect;
export async function getReviewQueue(
  userId: string,
  now = new Date(),
): Promise<ReviewQueue> {
  const { where, settings, summary, remaining } = await queueState(userId, now);
  const [older, newer] = await Promise.all([
    getDb().card.findMany({
      where: { AND: [where, introduced, { dueAt: { lte: now } }] },
      select: frontSelect,
      orderBy: order,
      take: settings.queuePageSize,
    }),
    remaining
      ? getDb().card.findMany({
          where: { AND: [where, fresh, { dueAt: { lte: now } }] },
          select: frontSelect,
          orderBy: order,
          take: Math.min(remaining, settings.queuePageSize),
        })
      : Promise.resolve([]),
  ]);
  const cards: ReviewFront[] = [
    ...new Map([...older, ...newer].map((c) => [c.id, c])).values(),
  ]
    .sort(
      (a, b) =>
        a.dueAt.getTime() - b.dueAt.getTime() || a.id.localeCompare(b.id),
    )
    .slice(0, settings.queuePageSize)
    .flatMap((c) => {
      const source = c.source === "GAP" ? c.gap : c.question;
      if (!source || source.topicId !== c.topicId) return [];
      return [
        {
          id: c.id,
          revision: c.revision,
          topicVersion: c.topic.version,
          source: c.source,
          prompt: c.source === "GAP" ? c.gap!.sentence : c.question!.stem,
          subjectTitle: c.topic.subject.title,
          topicTitle: c.topic.title,
        },
      ];
    });
  return { cards, summary };
}
async function ownedCard(tx: Db, userId: string, id: string) {
  const card = await tx.card.findFirst({
    where: { id, userId },
    select: { topicId: true },
  });
  if (!card) throw new ContentError("Карточка не найдена.", 404);
  await lock(tx, `content:topic:${card.topicId}`);
  const row = await tx.card.findFirst({
    where: { id, userId },
    include: {
      gap: true,
      question: true,
      topic: { include: { subject: { select: { status: true, slug: true } } } },
    },
  });
  if (!row) throw new ContentError("Карточка не найдена.", 404);
  return row;
}
type Owned = Awaited<ReturnType<typeof ownedCard>>;
async function available(
  tx: Db,
  row: Owned,
  userId: string,
  revision: number,
  topicVersion: number,
  now: Date,
) {
  if (row.revision !== revision || row.topic.version !== topicVersion)
    throw new ContentError("Карточка обновилась. Обновите очередь.", 409);
  if (
    row.suspended ||
    row.topic.status !== "PUBLISHED" ||
    row.topic.subject.status !== "PUBLISHED" ||
    row.dueAt > now
  )
    throw new ContentError(
      "Эту карточку пока нельзя повторять. Обновите очередь.",
      409,
    );
  const source = row.source === "GAP" ? row.gap : row.question;
  if (!source || source.archivedAt || source.topicId !== row.topicId)
    throw new ContentError("Материал карточки больше не доступен.", 409);
  if (!(await hasAccess(userId, row.topic, tx)))
    throw new ContentError("Для этой карточки нужен доступ к предмету.", 403);
}
export async function revealCard(
  userId: string,
  id: string,
  revision: number,
  topicVersion: number,
  now = new Date(),
): Promise<ReviewBack> {
  const settings = await reviewSettings();
  return getDb().$transaction(async (tx) => {
    await lock(tx, `srs:user:${userId}`);
    const user = await validUser(userId, tx),
      row = await ownedCard(tx, userId, id);
    await available(tx, row, userId, revision, topicVersion, now);
    if (row.state === "NEW" && !row.firstShownAt) {
      const window = dayWindow(now, user.timezone),
        count = await tx.card.count({
          where: {
            userId,
            firstShownAt: { gte: window.start, lt: window.end },
          },
        });
      if (count >= settings.newCardsPerDay)
        throw new ContentError(
          "Лимит новых карточек на сегодня исчерпан. Остальные появятся завтра.",
          409,
        );
    }
    await tx.card.update({
      where: { id },
      data: {
        firstShownAt: row.firstShownAt ?? now,
        revealedAt: now,
        revealedTopicVersion: topicVersion,
      },
    });
    let answers: string[],
      alternatives: string[] = [],
      explanation: string,
      context: string | null = null,
      block: string | null = null;
    if (row.source === "GAP") {
      const gap = row.gap!;
      answers =
        gap.answerType === "SHORT_TEXT"
          ? [gap.acceptedAnswers[0] ?? gap.answer]
          : gap.correctAnswers.length
            ? gap.correctAnswers
            : [gap.answer];
      alternatives =
        gap.answerType === "SHORT_TEXT" ? gap.acceptedAnswers.slice(1) : [];
      explanation = gap.explanation;
      context = gapContext(row.topic.contentMd, gap.gapKey, answers.join("; "));
      block = gap.blockKey;
    } else {
      const q = row.question!;
      const options = optionsFromJSON(q.options);
      answers =
        q.answerType === "SHORT_TEXT"
          ? [q.acceptedAnswers[0] ?? ""]
          : q.correctOptionIds.map(
              (id) => options.find((o) => o.id === id)?.text ?? "",
            );
      alternatives =
        q.answerType === "SHORT_TEXT" ? q.acceptedAnswers.slice(1) : [];
      explanation = q.explanation;
      block = q.sourceBlockKey;
    }
    return {
      id,
      revision,
      topicVersion,
      answers,
      alternatives,
      explanation,
      context,
      lessonHref:
        lessonHref(row.topic.subject.slug, row.topic.slug) +
        (block ? `#b-${block}` : ""),
      choices: (["HARD", "GOOD", "EASY"] as const).map((rating) => {
        const result = schedule(row, rating, now, settings);
        return {
          rating,
          label: intervalLabel(rating, result, settings),
          dueAt: result.dueAt.toISOString(),
        };
      }),
    };
  });
}
export async function rateCard(
  userId: string,
  id: string,
  revision: number,
  topicVersion: number,
  rating: Rating,
  now = new Date(),
) {
  const settings = await reviewSettings();
  return getDb().$transaction(async (tx) => {
    await lock(tx, `srs:user:${userId}`);
    await validUser(userId, tx);
    const row = await ownedCard(tx, userId, id);
    const previous = await tx.reviewLog.findUnique({
      where: { cardId_cardRevision: { cardId: id, cardRevision: revision } },
    });
    if (previous) {
      if (previous.rating !== rating)
        throw new ContentError(
          "Эта карточка уже получила другую оценку. Обновите очередь.",
          409,
        );
      return { applied: true, duplicate: true };
    }
    await available(tx, row, userId, revision, topicVersion, now);
    if (!row.revealedAt || row.revealedTopicVersion !== topicVersion)
      throw new ContentError("Сначала откройте ответ карточки.", 409);
    const next = schedule(row, rating, now, settings);
    await tx.card.update({
      where: { id },
      data: {
        ...next,
        revision: { increment: 1 },
        revealedAt: null,
        revealedTopicVersion: null,
      },
    });
    await tx.reviewLog.create({
      data: {
        cardId: id,
        cardRevision: revision,
        rating,
        prevIntervalDays: row.intervalDays,
        newIntervalDays: next.intervalDays,
        reviewedAt: now,
      },
    });
    return { applied: true, duplicate: false };
  });
}
