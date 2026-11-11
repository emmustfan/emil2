import { requireEditor } from "@/lib/auth/server";
import { getSubject, getTopic, listSections } from "@/lib/content/service";
import { contentPage } from "@/lib/content/page";
import { getDb } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { parseTopic } from "@/lib/content/parse";
import { LessonBook } from "./lesson-book";
import { SubjectImport } from "./subject-import";
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
    ? await contentPage(() => getTopic(topicId, undefined, user.id))
    : null;
  const subject =
    chosen?.subject ??
    (await contentPage(() => getSubject(subjectId!, user.id)));
  const [
    sections,
    topics,
    autosaveMs,
    minQuestions,
    maxQuestions,
    imageMaxBytes,
  ] = await Promise.all([
    listSections(subject.id, user.id),
    getDb().topic.findMany({
      where: { subjectId: subject.id },
      select: {
        id: true,
        title: true,
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
      ? await contentPage(() => getTopic(topics[0].id, undefined, user.id))
      : null);
  return (
    <LessonBook
      subject={subject}
      initial={topic ? { topic, parsed: parseTopic(topic.contentMd) } : null}
      initialSections={sections}
      initialTopics={topics}
      startCreating={create}
      settings={{ autosaveMs, minQuestions, maxQuestions, imageMaxBytes }}
      upload={
        <SubjectImport
          actorId={user.id}
          subject={subject}
          sections={sections}
          timeZone={user.timezone}
        />
      }
    />
  );
}
