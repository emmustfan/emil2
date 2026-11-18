import { importLimits } from "@/lib/imports/policy";
import type { ContentReader } from "@/lib/org";
import { listImports } from "@/lib/imports/service";
import { ImportWorkspace } from "./import-workspace";
export async function SubjectImport({
  actor,
  subject,
  sections,
  timeZone,
}: {
  actor: ContentReader;
  subject: { id: string; title: string };
  sections: { id: string; title: string }[];
  timeZone: string;
}) {
  const [limits, jobs] = await Promise.all([
    importLimits(),
    listImports(actor, subject.id),
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
