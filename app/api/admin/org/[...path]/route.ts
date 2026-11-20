import { assertOrigin, readInput } from "@/lib/auth/http";
import {
  contentFailure,
  contentJSON,
  requireContentEditor,
} from "@/lib/content/http";
import { ContentError } from "@/lib/content/errors";
import {
  changeAssignment,
  saveDepartment,
  saveFaculty,
  updateReviewerRule,
} from "@/lib/org/service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    assertOrigin(request);
    const actor = await requireContentEditor();
    if (actor.readOnly)
      throw new ContentError(
        "Режим просмотра: изменения от имени пользователя запрещены",
        403,
      );
    const [entity, id, extra] = (await params).path;
    if (extra) throw new ContentError("Маршрут не найден.", 404);
    const input = await readInput(request);
    if (entity === "faculties")
      return contentJSON(await saveFaculty(actor.id, id ?? null, input));
    if (entity === "departments")
      return contentJSON(await saveDepartment(actor.id, id ?? null, input));
    if (entity === "reviewer-rule" && id)
      return contentJSON(await updateReviewerRule(actor.id, id, input));
    if (entity === "assignments" && (id === "add" || id === "remove")) {
      await changeAssignment(actor.id, input, id === "remove");
      return contentJSON({ ok: true });
    }
    throw new ContentError("Маршрут не найден.", 404);
  } catch (error) {
    return contentFailure(error);
  }
}
