import { landingSchema } from "../lib/landing/defaults";
import { upgradeBillingCopy } from "../lib/landing/upgrade-billing";
import { BILLING_CONTENT } from "../lib/billing/config";
import { LANDING_DEFAULTS } from "../lib/landing/defaults";
import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { z } from "zod";
import { getDb } from "../lib/db";
import { DEFAULT_SETTINGS } from "../lib/settings/defaults";
import { ru } from "../lib/i18n/ru";
import { parseTopic } from "../lib/content/parse";

const db = getDb();
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const questionSchema = z.array(
  z.object({
    stem: z.string(),
    options: z.array(z.string()).min(2),
    correct: z.tuple([z.number().int().nonnegative()]),
    explanation: z.string(),
    sourceHeading: z.string(),
    diagnostic: z.boolean(),
  }),
);
try {
  await db.$transaction(
    async (tx) => {
      for (const [key, value] of Object.entries(DEFAULT_SETTINGS))
        await tx.appSetting.upsert({
          where: { key },
          create: { key, value },
          update: {},
        });
      const plans = [
        {
          code: "free",
          kind: "FREE" as const,
          title: "Бесплатный",
          priceKopecks: 0,
          tutorDailyLimit: 15,
          features: ["Бесплатные темы", "Повторение"],
        },
        {
          code: "subject_month",
          kind: "SUBJECT" as const,
          title: "Предмет",
          priceKopecks: 59900,
          tutorDailyLimit: 150,
          features: ["Один предмет", "Тесты", "Повторение", "ИИ-тьютор"],
        },
        {
          code: "all_month",
          kind: "ALL_SUBJECTS" as const,
          title: "Все предметы",
          priceKopecks: 149000,
          tutorDailyLimit: 150,
          features: ["Все предметы", "Тесты", "Повторение", "ИИ-тьютор"],
        },
      ];
      for (const [order, plan] of plans.entries())
        await tx.plan.upsert({
          where: { code: plan.code },
          create: { ...plan, order },
          update: {},
        });
      for (const email of (process.env.ADMIN_EMAILS ?? "")
        .split(",")
        .map((v) => v.trim().toLowerCase())
        .filter(Boolean)) {
        z.email().parse(email);
        await tx.user.upsert({
          where: { email },
          create: { email, role: "ADMIN" },
          update: { role: "ADMIN" },
        });
      }
      for (const kind of ["oferta", "privacy", "consent", "refund"])
        await tx.legalDocument.upsert({
          where: { kind_version: { kind, version: "0.1" } },
          create: {
            kind,
            version: "0.1",
            contentMd:
              "Текст готовит юрист. Документ является заглушкой для разработки и не предназначен для запуска продукта.",
            publishedAt: new Date("2026-11-06T00:00:00Z"),
          },
          update: {},
        });
      const landing = {
        "landing.v1": LANDING_DEFAULTS,
        "billing.v1": BILLING_CONTENT,
        hero: { title: ru.title, description: ru.description },
        howItWorks: ru.features,
        faq: [{ question: "Это медицинская услуга?", answer: ru.disclaimer }],
      };
      for (const [key, value] of Object.entries(landing))
        await tx.landingContent.upsert({
          where: { key },
          create: { key, value },
          update: {},
        });
      const currentLanding = await tx.landingContent.findUnique({
        where: { key: "landing.v1" },
      });
      const parsedLanding = landingSchema.safeParse(currentLanding?.value);
      if (currentLanding && parsedLanding.success) {
        const updated = upgradeBillingCopy(parsedLanding.data);
        if (JSON.stringify(updated) !== JSON.stringify(parsedLanding.data))
          await tx.landingContent.updateMany({
            where: {
              key: "landing.v1",
              value: { equals: currentLanding.value! },
            },
            data: { value: updated },
          });
      }
      for (const [order, [code, title]] of [
        ["video", "Видеоразборы"],
        ["voice-tutor", "Голосовой тьютор"],
        ["oral-exam", "Устный экзамен"],
        ["notes", "Конспект из лекции"],
      ].entries())
        await tx.fakeDoorFeature.upsert({
          where: { code },
          create: {
            code,
            title,
            description: "Проверяем интерес к будущей функции",
            order,
          },
          update: {},
        });
      const subject = await tx.subject.upsert({
        where: { slug: "propaedeutics" },
        create: {
          slug: "propaedeutics",
          title: "Пропедевтика стоматологических заболеваний",
          shortDescription: "Учебные демо-материалы для разработки",
          courses: [1, 2, 3],
        },
        update: {},
      });
      const section = await tx.section.upsert({
        where: { id: "seed-propaedeutics-anatomy" },
        create: {
          id: "seed-propaedeutics-anatomy",
          subjectId: subject.id,
          title: "Анатомия и нумерация зубов",
          order: 1,
        },
        update: {},
      });
      for (const slug of ["fdi-numbering", "primary-dentition"]) {
        const raw = await readFile(
          `content-seed/propaedeutics/${slug}.md`,
          "utf8",
        );
        const [, frontmatter, contentMd] = raw.split(/^---\s*$/m);
        const meta = z
          .object({
            title: z.string(),
            order: z.number().int(),
            isFree: z.boolean(),
          })
          .parse(parse(frontmatter));
        const topic = await tx.topic.upsert({
          where: { subjectId_slug: { subjectId: subject.id, slug } },
          create: {
            ...meta,
            subjectId: subject.id,
            sectionId: section.id,
            slug,
            contentMd,
            needsExpertReview: true,
            status: "DRAFT",
            referencesMd:
              "Учебный пример из ТЗ. Источники и формулировки подлежат проверке экспертом.",
          },
          update: {},
        });
        // Fixtures are initialized only until the first editorial change/publication.
        if (
          topic.editRevision > 0 ||
          topic.version > 0 ||
          topic.contentMd !== contentMd
        )
          continue;
        const parsed = parseTopic(contentMd);
        if (parsed.errors.length)
          throw new Error(`Invalid seed Markdown: ${slug}`);
        for (const gap of parsed.gaps) {
          const { gapKey, blockKey, order, answer, distractors, sentence } =
            gap;
          await tx.gap.upsert({
            where: { topicId_gapKey: { topicId: topic.id, gapKey } },
            create: {
              topicId: topic.id,
              gapKey,
              blockKey,
              order,
              answer,
              distractors,
              sentence,
            },
            update: { blockKey },
          });
        }
        const questions = questionSchema.parse(
          parse(
            await readFile(
              `content-seed/propaedeutics/${slug}.questions.yaml`,
              "utf8",
            ),
          ),
        );
        for (const [order, q] of questions.entries()) {
          if (q.correct[0] >= q.options.length)
            throw new Error("Invalid seed question answer");
          const id = `seed-${slug}-${order}`;
          const sourceBlockKey = parsed.blocks.find(
            (block) =>
              block.heading === q.sourceHeading && block.kind !== "heading",
          )?.blockKey;
          if (!sourceBlockKey)
            throw new Error(`Seed source heading not found: ${slug}`);
          const saved = await tx.question.upsert({
            where: { id },
            create: {
              id,
              topicId: topic.id,
              stem: q.stem,
              options: q.options.map((text, i) => ({ id: String(i), text })),
              correctOptionIds: q.correct.map(String),
              explanation: q.explanation,
              sourceBlockKey,
              isDiagnostic: q.diagnostic,
              order,
            },
            update: {},
          });
          if (saved.sourceBlockKey === digest(q.sourceHeading))
            await tx.question.update({
              where: { id },
              data: { sourceBlockKey },
            });
        }
      }
    },
    { timeout: 30000 },
  );
  console.info(
    "Seed выполнен: настройки, тарифы, юридические заглушки и непроверенные демо-черновики.",
  );
} finally {
  await db.$disconnect();
}
