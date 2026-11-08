import { it, expect } from "vitest";
import sharp from "sharp";
import { renderToStaticMarkup } from "react-dom/server";
import { parseTopic } from "../../lib/content/parse";
import { normalizeImage, readImageForm } from "../../lib/content/images";
import { imageId, imageMarkdown } from "../../lib/content/image-reference";
import { LessonImage } from "../../components/content/lesson-image";
import { lessonReadiness } from "../../lib/content/readiness";
import { lessonReviewPrompt } from "../../lib/content/review-prompt";
import { integrationSummary } from "../../lib/admin/integrations";
import { parseEnv } from "../../lib/env";
const id = "10000000-0000-4000-8000-000000000001",
  limits = {
    maxBytes: 5242880,
    maxPixels: 20000000,
    maxSide: 2400,
    maxPerTopic: 30,
  };
it("accepts owned image URLs with captions while rejecting remote, executable and missing descriptions", () => {
  const md = imageMarkdown(id, "Схема [пример]", 100, 50),
    parsed = parseTopic(md);
  expect(parsed.errors).toEqual([]);
  expect(parsed.images).toEqual([{ id, line: 1 }]);
  expect(parsed.blocks[0].text).toBe("Схема [пример]");
  for (const src of [
    "https://outside.test/a.png",
    "data:image/svg+xml,x",
    "javascript:x",
    "/api/content-images/not-an-id",
  ]) {
    expect(imageId(src)).toBeNull();
    expect(
      parseTopic(`![Описание](${src})`).errors.some((e) => e.code === "image"),
    ).toBe(true);
    expect(renderToStaticMarkup(<LessonImage src={src} />)).not.toContain(
      "<img",
    );
  }
  expect(parseTopic(`![](/api/content-images/${id})`).errors[0].code).toBe(
    "image",
  );
});
it("decodes raster content, bounds dimensions and strips source metadata", async () => {
  const input = await sharp({
    create: { width: 3000, height: 20, channels: 3, background: "#08634f" },
  })
    .withMetadata({ exif: { IFD0: { Artist: "PRIVATE_ARTIST" } } })
    .png()
    .toBuffer();
  const result = await normalizeImage(input, "image/png", limits),
    meta = await sharp(result.body).metadata();
  expect(meta.format).toBe("webp");
  expect(result.width).toBe(2400);
  expect(meta.exif).toBeUndefined();
  expect(result.body.includes(Buffer.from("PRIVATE_ARTIST"))).toBe(false);
});
it("rejects forged SVG/HTML, malformed rasters, oversized bytes and excessive pixels", async () => {
  for (const body of [
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    Buffer.from("<html>bad</html>"),
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  ])
    await expect(normalizeImage(body, "image/png", limits)).rejects.toThrow();
  const valid = await sharp({
    create: { width: 20, height: 20, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  await expect(
    normalizeImage(valid, "image/png", { ...limits, maxBytes: 1 }),
  ).rejects.toMatchObject({ status: 413 });
  await expect(
    normalizeImage(valid, "image/png", { ...limits, maxPixels: 10 }),
  ).rejects.toThrow();
});
it("bounds a chunked multipart body without trusting Content-Length", async () => {
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array(65538));
      c.close();
    },
  });
  const request = new Request("http://local", {
    method: "POST",
    body: stream,
    duplex: "half",
  } as RequestInit);
  await expect(readImageForm(request, 1)).rejects.toMatchObject({
    status: 413,
  });
});
it("shows incomplete lesson readiness, validates exercise configurations and checks image ownership", () => {
  const parsed = parseTopic("Вопрос [[ответ|ошибка]]."),
    form = {
      title: "Урок",
      slug: "urok",
      sectionId: null,
      order: 0,
      isFree: true,
      contentMd: "Вопрос [[ответ|ошибка]].",
      readingMinutes: null,
      authorName: null,
      reviewerName: null,
      referencesMd: null,
      reviewed: false,
    };
  const rows = lessonReadiness(form, parsed, [], {
    minQuestions: 5,
    maxQuestions: 15,
    subjectPublished: false,
    status: "DRAFT",
    imageIds: [],
    previewCurrent: true,
  });
  expect(rows.find((r) => r.id === "gaps")?.ok).toBe(true);
  expect(rows.find((r) => r.id === "questions")?.ok).toBe(false);
  expect(rows.find((r) => r.id === "expert")?.ok).toBe(false);
  const image = parseTopic(imageMarkdown(id, "Схема"));
  expect(
    lessonReadiness(form, image, [], {
      minQuestions: 5,
      maxQuestions: 15,
      subjectPublished: true,
      status: "REVIEW",
      imageIds: [],
      previewCurrent: true,
    }).find((r) => r.id === "images")?.ok,
  ).toBe(false);
});
it("builds an advisory review request with exercise answers without account data or private image URLs", () => {
  const md = `Личная почта private@example.test.\n\nВопрос [[ответ|нет]].\n\n${imageMarkdown(id, "Схема")}`,
    prompt = lessonReviewPrompt(md, [], "Справочник", parseTopic(md));
  expect(prompt).toContain("ответ");
  expect(prompt).toContain("не разрешаешь публикацию");
  expect(prompt).not.toContain("private@example.test");
  expect(prompt).not.toContain(id);
  expect(prompt).not.toContain("/api/content-images/");
});
it("reports configuration modes without exposing integration secrets or asserting a successful connection", () => {
  const env = parseEnv({
    DATABASE_URL: "postgresql://app:app@localhost:5432/app",
    TELEGRAM_BOT_TOKEN: "PRIVATE_BOT_TOKEN",
    TELEGRAM_BOT_USERNAME: "fixture_bot",
    LLM_API_KEY: "PRIVATE_LLM_KEY",
    SMTP_PASSWORD: "PRIVATE_SMTP_PASSWORD",
  });
  const wire = JSON.stringify(integrationSummary(env));
  expect(wire).not.toContain("PRIVATE_");
  expect(wire).toContain("Тестовая модель");
  expect(wire).toContain("Настройки бота заданы");
});
