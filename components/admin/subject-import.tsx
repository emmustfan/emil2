import { importLimits } from "@/lib/imports/policy";
import { listImports } from "@/lib/imports/service";
import { ImportWorkspace } from "./import-workspace";
export async function SubjectImport({
  actorId,
  subject,
  sections,
  timeZone,
}: {
  actorId: string;
  subject: { id: string; title: string };
  sections: { id: string; title: string }[];
  timeZone: string;
}) {
  const [limits, jobs] = await Promise.all([
    importLimits(),
    listImports(actorId, subject.id),
  ]);
  return (
    <ImportWorkspace
      subjects={[{ ...subject, sections }]}
      initial={jobs}
      initialSubject={subject.id}
      maxBytes={limits.maxBytes}
      timeZone={timeZone}
      mock={process.env.LLM_PROVIDER === "mock" || !process.env.LLM_PROVIDER}
      lockedSubject
    />
  );
}
