import { assertOrigin } from "@/lib/auth/http";
import {
  requireContentEditor,
  contentJSON,
  contentFailure,
} from "@/lib/content/http";
import { ContentError } from "@/lib/content/errors";
import { readImageForm } from "@/lib/content/images";
import { importLimits } from "@/lib/imports/policy";
import { createImport, listImports } from "@/lib/imports/service";
export async function GET(request: Request) {
  try {
    const actor = await requireContentEditor(),
      subjectId =
        new URL(request.url).searchParams.get("subjectId") ?? undefined;
    return contentJSON(await listImports(actor.id, subjectId));
  } catch (e) {
    return contentFailure(e);
  }
}
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const actor = await requireContentEditor(),
      limits = await importLimits(),
      form = await readImageForm(request, limits.maxBytes);
    const allowed = [
      "file",
      "text",
      "subjectId",
      "sectionId",
      "rightsConfirmed",
    ];
    if (
      [...form.keys()].some(
        (key) => !allowed.includes(key) || form.getAll(key).length !== 1,
      )
    )
      throw new ContentError("Проверьте форму импорта.");
    const file = form.get("file"),
      text = form.get("text");
    if (file instanceof File === (typeof text === "string" && !!text.trim()))
      throw new ContentError("Загрузите один файл или вставьте текст.");
    const body =
      file instanceof File
        ? Buffer.from(await file.arrayBuffer())
        : Buffer.from(String(text), "utf8");
    return contentJSON(
      await createImport(
        actor.id,
        {
          subjectId: form.get("subjectId"),
          sectionId: form.get("sectionId") || null,
          rightsConfirmed: form.get("rightsConfirmed") === "true",
        },
        file instanceof File ? file.name : "source.txt",
        body,
      ),
      201,
    );
  } catch (e) {
    return contentFailure(e);
  }
}
