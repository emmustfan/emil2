import { assertOrigin, readInput } from "@/lib/auth/http";
import {
  contentFailure,
  contentJSON,
  requireContentEditor,
} from "@/lib/content/http";
import { AuthError } from "@/lib/auth/errors";
import { archiveVideo, saveVideo } from "@/lib/video/admin";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertOrigin(request);
    const actor = await requireContentEditor();
    if (actor.readOnly) throw new AuthError("forbidden", 403);
    const { id } = await params;
    return contentJSON(
      await saveVideo(
        actor.id,
        id === "new" ? null : id,
        await readInput(request),
      ),
    );
  } catch (error) {
    return contentFailure(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertOrigin(request);
    const actor = await requireContentEditor();
    if (actor.readOnly) throw new AuthError("forbidden", 403);
    return contentJSON(await archiveVideo(actor.id, (await params).id));
  } catch (error) {
    return contentFailure(error);
  }
}
