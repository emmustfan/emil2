import { requireEditor } from "@/lib/auth/server";
import { redirect } from "next/navigation";
import { getSubject, getTopic, listSections } from "@/lib/content/service";
import { contentPage } from "@/lib/content/page";
import { getDb } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { parseTopic } from "@/lib/content/parse";
import { LessonBook } from "./lesson-book";
import { SubjectImport } from "./subject-import";
import { getEnv } from "@/lib/env";
import { allowsQuickPublication } from "@/lib/content/preview-access";
export async function LessonBookPage({
  topicId,
  subjectId,
  create = false,
}: {
  topicId?: string;
  subjectId?: string;
  create?: boolean;
}) {
  const user = await requireEditor();
  const chosen = topicId
    ? await contentPage(() => getTopic(topicId, undefined, user))
    : null;
  const subject =
    chosen?.subject ?? (await contentPage(() => getSubject(subjectId!, user)));
  if (subject.archivedAt) redirect(`/admin/subjects/${subject.id}`);
  const [
    sections,
    topics,
    autosaveMs,
    minQuestions,
    maxQuestions,
    imageMaxBytes,
  ] = await Promise.all([
    listSections(subject.id, user),
    getDb().topic.findMany({
      where: { subjectId: subject.id, archivedAt: null },
      select: {
        id: true,
        draftTitle: true,
        draftState: true,
        sectionId: true,
        status: true,
        isFree: true,
        order: true,
      },
      orderBy: [{ order: "asc" }, { id: "asc" }],
    }),
    getSetting("content.autosaveMs"),
    getSetting("content.minQuestions"),
    getSetting("content.maxQuestions"),
    getSetting("content.imageMaxBytes"),
  ]);
  const topic =
    chosen ??
    (!create && topics.length
      ? await contentPage(() => getTopic(topics[0].id, undefined, user))
      : null);
  return (
    <LessonBook
      subject={subject}
      initial={topic ? { topic, parsed: parseTopic(topic.contentMd) } : null}
      initialSections={sections}
      initialTopics={topics.map((topic) => ({
        ...topic,
        title: topic.draftTitle,
      }))}
      startCreating={create}
      settings={{
        autosaveMs,
        minQuestions,
        maxQuestions,
        imageMaxBytes,
        timeZone: user.timezone,
        quickPublication: allowsQuickPublication(getEnv()),
      }}
      upload={
        <SubjectImport
          actor={user}
          subject={subject}
          sections={sections}
          timeZone={user.timezone}
        />
      }
    />
  );
}
