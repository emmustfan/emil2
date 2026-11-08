import { z } from "zod";
import { Prisma } from "../generated/prisma/client";
import { getDb } from "../db";
import { contentActor } from "../content/permissions";
import { redactPersonalData } from "../tutor/privacy";
import { readCitations } from "../tutor/service";
import { reportInput, reportRange, identifier } from "./policy";
import { getSetting } from "../settings";
import { ContentError } from "../content/errors";
export const logInput = reportInput.omit({ source: true }).extend({
  subjectId: identifier.optional(),
  inaccurate: z.enum(["", "yes"]).default(""),
});
export async function tutorLogs(actorId: string, raw: unknown) {
  const actor = await contentActor(actorId),
    input = logInput.parse(raw);
  let range: ReturnType<typeof reportRange>;
  try {
    range = reportRange({ ...input, source: "" });
  } catch {
    throw new ContentError("Выберите корректный период не длиннее года.");
  }
  const subjects = await getDb().subject.findMany({
    where:
      actor?.role === "EDITOR"
        ? { teachingAssignments: { some: { teacherId: actor.id } } }
        : {},
    select: { id: true, title: true },
    orderBy: { title: "asc" },
  });
  const ids = subjects.map((s) => s.id),
    size = await getSetting("content.pageSize");
  if (input.subjectId && !ids.includes(input.subjectId))
    throw new ContentError("Предмет не найден.", 404);
  const where = {
    role: "ASSISTANT" as const,
    createdAt: { gte: range.start, lt: range.end },
    conversation: { subjectId: input.subjectId ?? { in: ids } },
    ...(input.inaccurate ? { feedback: -1 } : {}),
  };
  const [rows, total, daily] = await Promise.all([
    getDb().tutorMessage.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (input.page - 1) * size,
      take: size,
      select: {
        id: true,
        content: true,
        citations: true,
        model: true,
        tokensIn: true,
        tokensOut: true,
        feedback: true,
        createdAt: true,
        replyToId: true,
        conversation: { select: { subject: { select: { title: true } } } },
      },
    }),
    getDb().tutorMessage.count({ where }),
    getDb().$queryRaw<
      { day: string; input: number; output: number }[]
    >(Prisma.sql`
      SELECT to_char(m."createdAt",'YYYY-MM-DD') AS "day",COALESCE(SUM(m."tokensIn"),0)::float AS "input",COALESCE(SUM(m."tokensOut"),0)::float AS "output"
      FROM "TutorMessage" m JOIN "TutorConversation" c ON c.id=m."conversationId"
      WHERE m.role='ASSISTANT' AND m."createdAt">=${range.start} AND m."createdAt"<${range.end}
      AND c."subjectId"=ANY(${input.subjectId ? [input.subjectId] : ids}::text[])
      AND (${input.inaccurate}='' OR m.feedback=-1)
      GROUP BY 1 ORDER BY 1 DESC`),
  ]);
  const questions = await getDb().tutorMessage.findMany({
    where: {
      id: { in: rows.flatMap((r) => (r.replyToId ? [r.replyToId] : [])) },
    },
    select: { id: true, content: true },
  });
  // DTO deliberately omits conversations, session IDs, account IDs and contacts for both roles.
  return {
    range,
    subjects,
    total,
    page: input.page,
    pages: Math.max(1, Math.ceil(total / size)),
    daily,
    items: rows.map((r) => ({
      id: r.id,
      answer: redactPersonalData(r.content),
      question: redactPersonalData(
        questions.find((q) => q.id === r.replyToId)?.content ??
          "Вопрос недоступен",
      ),
      subject: r.conversation.subject.title,
      model: r.model,
      tokensIn: r.tokensIn,
      tokensOut: r.tokensOut,
      feedback: r.feedback,
      createdAt: r.createdAt.toISOString(),
      citations: (readCitations(r.citations) ?? []).map((c) => ({
        n: c.n,
        title: c.topicTitle,
        href: c.href,
      })),
    })),
  };
}
