import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { getDb } from "../db";
import { getEnv } from "../env";
import { getSetting } from "../settings";
import { createStorageDriver } from "../storage";
import { contentActor, contentWrite, authorizeSubject } from "./permissions";
import { ContentError } from "./errors";
import { lock } from "../auth/session";
import { consumeLimit, hasAccess } from "../access";
import { hasCurrentConsent } from "../auth/legal";
import { parseTopic } from "./parse";
export async function imageLimits() {
  const [maxBytes, maxPixels, maxSide, maxPerTopic] = await Promise.all([
    getSetting("content.imageMaxBytes"),
    getSetting("content.imageMaxPixels"),
    getSetting("content.imageMaxSide"),
    getSetting("content.imagesPerTopic"),
  ]);
  return { maxBytes, maxPixels, maxSide, maxPerTopic };
}
export async function normalizeImage(
  body: Buffer,
  mime: string,
  limits: Awaited<ReturnType<typeof imageLimits>>,
) {
  if (!body.length || body.length > limits.maxBytes)
    throw new ContentError("Размер изображения превышает лимит.", 413);
  if (!["image/png", "image/jpeg", "image/webp"].includes(mime))
    throw new ContentError("Выберите PNG, JPEG или WebP.");
  const png = body
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    jpeg = body[0] === 255 && body[1] === 216 && body[2] === 255,
    webp =
      body.toString("ascii", 0, 4) === "RIFF" &&
      body.toString("ascii", 8, 12) === "WEBP";
  if (!png && !jpeg && !webp)
    throw new ContentError("Содержимое файла не является PNG, JPEG или WebP.");
  try {
    const options = {
      limitInputPixels: limits.maxPixels,
      failOn: "error" as const,
      animated: false,
    };
    const metadata = await sharp(body, options).metadata();
    if (
      !["png", "jpeg", "webp"].includes(metadata.format ?? "") ||
      (metadata.pages ?? 1) > 1
    )
      throw new Error("Unsupported image");
    const result = await sharp(body, options)
      .rotate()
      .resize({
        width: limits.maxSide,
        height: limits.maxSide,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 90 })
      .toBuffer({ resolveWithObject: true });
    if (result.data.length > limits.maxBytes)
      throw new Error("Output too large");
    return {
      body: result.data,
      width: result.info.width,
      height: result.info.height,
    };
  } catch {
    throw new ContentError(
      "Не удалось прочитать изображение. Выберите исправный PNG, JPEG или WebP в пределах лимита пикселей.",
    );
  }
}
export async function uploadTopicImage(
  actorId: string,
  topicId: string,
  body: Buffer,
  mime: string,
) {
  await contentActor(actorId);
  const topic = await getDb().topic.findUnique({
    where: { id: topicId },
    select: { subjectId: true },
  });
  if (!topic) throw new ContentError("Тема не найдена.", 404);
  await authorizeSubject(topic.subjectId, actorId);
  const limits = await imageLimits();
  await consumeLimit(`user:${actorId}`, {
    feature: "content-image",
    max: await getSetting("content.imageRequestsPerMinute"),
    periodStart: new Date(Math.floor(Date.now() / 60000) * 60000),
  });
  const image = await normalizeImage(body, mime, limits),
    id = randomUUID(),
    storageKey = `image_${id}`,
    storage = createStorageDriver(getEnv());
  await storage.put(storageKey, image.body);
  try {
    return await getDb().$transaction(async (tx) => {
      await contentWrite(tx, actorId);
      await lock(tx, `content:topic:${topicId}`);
      const current = await tx.topic.findUniqueOrThrow({
        where: { id: topicId },
      });
      await authorizeSubject(current.subjectId, actorId, tx);
      if (
        (await tx.topicImage.count({ where: { topicId } })) >=
        limits.maxPerTopic
      )
        throw new ContentError(
          "Достигнут лимит изображений для темы. Его можно изменить в настройках.",
        );
      await tx.topicImage.create({
        data: {
          id,
          topicId,
          storageKey,
          width: image.width,
          height: image.height,
          bytes: image.body.length,
        },
      });
      return {
        id,
        width: image.width,
        height: image.height,
        bytes: image.body.length,
      };
    });
  } catch (e) {
    await storage.remove(storageKey);
    throw e;
  }
}
export async function readTopicImage(id: string, userId: string | null) {
  const image = await getDb().topicImage.findUnique({
    where: { id },
    include: {
      topic: {
        select: {
          id: true,
          subjectId: true,
          status: true,
          isFree: true,
          needsExpertReview: true,
          contentMd: true,
          subject: { select: { status: true } },
        },
      },
    },
  });
  if (!image) throw new ContentError("Изображение не найдено.", 404);
  const user = userId
    ? await getDb().user.findUnique({ where: { id: userId } })
    : null;
  if (userId && (!user || user.blockedAt || user.deletedAt))
    throw new ContentError("Изображение недоступно.", 404);
  let editor = false;
  if (user && (await hasCurrentConsent(user)))
    editor =
      user.role === "ADMIN" ||
      (user.role === "EDITOR" &&
        !!(await getDb().teacherSubject.count({
          where: { teacherId: user.id, subjectId: image.topic.subjectId },
        })));
  if (
    !editor &&
    (!(!user || (await hasCurrentConsent(user))) ||
      image.topic.status !== "PUBLISHED" ||
      image.topic.subject.status !== "PUBLISHED" ||
      image.topic.needsExpertReview ||
      !parseTopic(image.topic.contentMd).images.some((a) => a.id === id) ||
      !(await hasAccess(userId, image.topic)))
  )
    throw new ContentError("Изображение недоступно.", 404);
  return {
    body: await createStorageDriver(getEnv()).get(image.storageKey),
    width: image.width,
    height: image.height,
  };
}
export async function readImageForm(request: Request, maxBytes: number) {
  const limit = maxBytes + 65536;
  if (Number(request.headers.get("content-length") ?? 0) > limit)
    throw new ContentError("Размер изображения превышает лимит.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new ContentError("Выберите файл изображения.");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new ContentError("Размер изображения превышает лимит.", 413);
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const body = Buffer.concat(chunks);
    return await new Request("http://upload.local", {
      method: "POST",
      headers: { "Content-Type": request.headers.get("content-type") ?? "" },
      body,
    }).formData();
  } catch {
    throw new ContentError("Не удалось прочитать форму загрузки.");
  }
}
