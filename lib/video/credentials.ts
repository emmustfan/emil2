import { ContentError } from "../content/errors";
import type { Prisma } from "../generated/prisma/client";

export type Credentials = { externalId: string; accessKey: string | null };
const rutubeUrl =
  /(?:https?:\/\/)?rutube\.ru\/(?:video\/|play\/embed\/)[^\s<>"'\])]+/gi;

export function redactVideoCredentials(text: string, videos: Credentials[]) {
  let result = text.replace(rutubeUrl, "[ссылка на видео]");
  for (const { externalId, accessKey } of videos) {
    result = result.replaceAll(externalId, "[идентификатор видео]");
    if (accessKey && accessKey.length >= 8)
      result = result.replaceAll(accessKey, "[ключ видео]");
    else if (accessKey)
      result = result.replaceAll(`?p=${accessKey}`, "?p=[ключ видео]");
  }
  return result;
}

export function rejectVideoCredentials(
  value: unknown,
  credentials: Credentials[] = [],
) {
  const content = JSON.stringify(value) ?? "";
  if (content !== redactVideoCredentials(content, credentials))
    throw new ContentError(
      "Ссылку Rutube добавляйте только через блок «Видео». Уберите ссылку и реквизиты плеера из учебного текста.",
    );
}

export async function checkTopicVideoText(
  tx: Prisma.TransactionClient,
  topicId: string,
  value: unknown,
) {
  rejectVideoCredentials(
    value,
    await tx.videoLecture.findMany({
      where: { topicId },
      select: { externalId: true, accessKey: true },
    }),
  );
}
