import { getDb } from "../db";
import { LANDING_DEFAULTS, landingSchema } from "./defaults";
export async function landingContent() {
  const row = await getDb().landingContent.findUnique({
    where: { key: "landing.v1" },
  });
  const parsed = landingSchema.safeParse(row?.value);
  return parsed.success ? parsed.data : LANDING_DEFAULTS;
}
export function publicExamples(
  content: Awaited<ReturnType<typeof landingContent>>,
) {
  return content.examples.map(({ id, stem, answerType, options }) => ({
    id,
    stem,
    answerType,
    options: [...options].sort((a, b) => a.id.localeCompare(b.id)),
  }));
}
