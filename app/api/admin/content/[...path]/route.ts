import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertOrigin, readInput } from "@/lib/auth/http";
import {
  contentFailure,
  contentJSON,
  requireContentEditor,
} from "@/lib/content/http";
import { ContentError } from "@/lib/content/errors";
import { parseTopic, MAX_MARKDOWN_CHARS } from "@/lib/content/parse";
import {
  subjectFields,
  sectionFields,
  topicFields,
  questionFields,
  revisionSchema,
  listSchema,
} from "@/lib/content/validation";
import * as service from "@/lib/content/service";
import { getDb } from "@/lib/db";
type Context = { params: Promise<{ path: string[] }> };
async function handle(request: NextRequest, context: Context, method: string) {
  try {
    if (method !== "GET") assertOrigin(request);
    await requireContentEditor();
    const { path } = await context.params;
    if (path.length > 3 || path.some((s) => s.length > 100))
      throw new ContentError("Маршрут не найден.", 404);
    const [entity, id, action] = path;
    let result: unknown;
    if (method === "GET") {
      const query = listSchema.parse(
        Object.fromEntries(request.nextUrl.searchParams),
      );
      if (entity === "subjects" && !id)
        result = await service.listSubjects(query.q, query.page);
      else if (entity === "subjects" && id && !action)
        result = await service.getSubject(id);
      else if (entity === "topics" && id && !action)
        result = await service.getTopic(id);
      else if (entity === "topics" && !id) {
        const subjectId = z
          .string()
          .min(1)
          .max(100)
          .parse(request.nextUrl.searchParams.get("subjectId"));
        result = await service.listTopics(subjectId, query.q, query.page);
      } else if (entity === "sections" && !id) {
        const subjectId = z
          .string()
          .min(1)
          .max(100)
          .parse(request.nextUrl.searchParams.get("subjectId"));
        result = await service.listSections(subjectId);
      } else if (entity === "sections" && id && !action)
        result = await getDb().section.findUniqueOrThrow({ where: { id } });
      else if (entity === "questions" && id && !action) {
        const row = await getDb().question.findUnique({
          where: { id, archivedAt: null },
        });
        if (!row) throw new ContentError("Вопрос не найден.", 404);
        result = row;
      } else throw new ContentError("Маршрут не найден.", 404);
      return contentJSON(result);
    }
    const input = await readInput(request, 512000);
    if (entity === "preview" && !id && method === "POST") {
      const { contentMd } = z
        .object({ contentMd: z.string().max(MAX_MARKDOWN_CHARS) })
        .strict()
        .parse(input);
      return contentJSON(parseTopic(contentMd));
    }
    if (entity === "subjects" && !id && method === "POST")
      result = await service.createSubject(subjectFields.parse(input));
    else if (entity === "subjects" && id && !action && method === "PATCH") {
      const { revision, ...fields } = subjectFields
        .extend({ revision: revisionSchema })
        .parse(input);
      result = await service.updateSubject(id, revision, fields);
    } else if (entity === "subjects" && id && !action && method === "DELETE") {
      const { revision } = z
        .object({ revision: revisionSchema })
        .strict()
        .parse(input);
      result = await service.deleteSubject(id, revision);
    } else if (entity === "sections" && !id && method === "POST") {
      const { subjectId, ...fields } = sectionFields
        .extend({ subjectId: z.string().min(1).max(100) })
        .parse(input);
      result = await service.createSection(subjectId, fields);
    } else if (entity === "sections" && id && !action && method === "PATCH") {
      const { revision, ...fields } = sectionFields
        .extend({ revision: revisionSchema })
        .parse(input);
      result = await service.updateSection(id, revision, fields);
    } else if (entity === "sections" && id && !action && method === "DELETE") {
      const { revision } = z
        .object({ revision: revisionSchema })
        .strict()
        .parse(input);
      result = await service.deleteSection(id, revision);
    } else if (entity === "topics" && !id && method === "POST") {
      const { subjectId, ...fields } = topicFields
        .extend({ subjectId: z.string().min(1).max(100) })
        .parse(input);
      result = await service.createTopic(subjectId, fields);
    } else if (entity === "topics" && id && !action && method === "PATCH") {
      const { revision, ...fields } = topicFields
        .extend({ revision: revisionSchema })
        .parse(input);
      result = await service.updateTopic(id, revision, fields);
    } else if (entity === "topics" && id && !action && method === "DELETE") {
      const { revision } = z
        .object({ revision: revisionSchema })
        .strict()
        .parse(input);
      result = await service.deleteTopic(id, revision);
    } else if (
      entity === "topics" &&
      id &&
      action === "status" &&
      method === "POST"
    ) {
      const { revision, status } = z
        .object({
          revision: revisionSchema,
          status: z.enum(["DRAFT", "REVIEW"]),
        })
        .strict()
        .parse(input);
      result = await service.setTopicStatus(id, revision, status);
    } else if (
      entity === "topics" &&
      id &&
      action === "publish" &&
      method === "POST"
    ) {
      const { revision } = z
        .object({ revision: revisionSchema })
        .strict()
        .parse(input);
      result = await service.publishTopic(id, revision);
    } else if (
      entity === "topics" &&
      id &&
      action === "questions" &&
      method === "POST"
    ) {
      const { topicRevision, ...fields } = questionFields
        .safeExtend({ topicRevision: revisionSchema })
        .parse(input);
      result = await service.createQuestion(id, topicRevision, fields);
    } else if (entity === "questions" && id && !action && method === "PATCH") {
      const { topicRevision, ...fields } = questionFields
        .safeExtend({ topicRevision: revisionSchema })
        .parse(input);
      result = await service.updateQuestion(id, topicRevision, fields);
    } else if (entity === "questions" && id && !action && method === "DELETE") {
      const { topicRevision } = z
        .object({ topicRevision: revisionSchema })
        .strict()
        .parse(input);
      result = await service.deleteQuestion(id, topicRevision);
    } else throw new ContentError("Маршрут не найден.", 404);
    for (const [path, type] of [
      ["/subjects", undefined],
      ["/subjects/[slug]", "page"],
      ["/learn/[subject]/[topic]", "page"],
      ["/admin", "layout"],
    ] as const)
      revalidatePath(path, type);
    return contentJSON(result, method === "POST" && !id ? 201 : 200);
  } catch (error) {
    return contentFailure(error);
  }
}
export function GET(r: NextRequest, c: Context) {
  return handle(r, c, "GET");
}
export function POST(r: NextRequest, c: Context) {
  return handle(r, c, "POST");
}
export function PATCH(r: NextRequest, c: Context) {
  return handle(r, c, "PATCH");
}
export function DELETE(r: NextRequest, c: Context) {
  return handle(r, c, "DELETE");
}
