import { assertOrigin } from "@/lib/auth/http";
import {
  requireContentEditor,
  contentJSON,
  contentFailure,
} from "@/lib/content/http";
import {
  imageLimits,
  readImageForm,
  uploadTopicImage,
} from "@/lib/content/images";
import { ContentError } from "@/lib/content/errors";
import { z } from "zod";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ topicId: string }> },
) {
  try {
    assertOrigin(request);
    const actor = await requireContentEditor(),
      { topicId } = await params;
    z.string()
      .regex(/^[a-zA-Z0-9_-]{1,100}$/)
      .parse(topicId);
    const limits = await imageLimits(),
      data = await readImageForm(request, limits.maxBytes),
      file = data.get("file");
    if (
      !(file instanceof File) ||
      [...data.keys()].some((k) => k !== "file") ||
      data.getAll("file").length !== 1
    )
      throw new ContentError("Выберите один файл изображения.");
    if (file.size > limits.maxBytes)
      throw new ContentError("Размер изображения превышает лимит.", 413);
    return contentJSON(
      await uploadTopicImage(
        actor.id,
        topicId,
        Buffer.from(await file.arrayBuffer()),
        file.type,
      ),
      201,
    );
  } catch (e) {
    return contentFailure(e);
  }
}
