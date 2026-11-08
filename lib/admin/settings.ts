import { z } from "zod";
import type { Prisma } from "../generated/prisma/client";
import { getDb } from "../db";
import { ContentError } from "../content/errors";
import { DEFAULT_SETTINGS, type SettingKey } from "../settings/defaults";
import { LANDING_DEFAULTS, landingSchema } from "../landing/defaults";
import { BILLING_CONTENT, billingContentSchema } from "../billing/config";
import { assertAdmin } from "./users";
import { adminAudit, adminWrite } from "./write";
import {
  planInput,
  settingInput,
  legalInput,
  revision,
  editableSettingKeys,
} from "./policy";
export const landingInput = z
  .object({
    revision,
    value: landingSchema
      .omit({ examples: true })
      .strict()
      .refine(
        (v) =>
          [
            v.brand,
            v.title,
            v.description,
            v.demoCta,
            v.disclaimer,
            v.paymentNote,
            ...v.benefits,
            ...v.how.flatMap((p) => [p.title, p.text]),
            ...v.inside.flatMap((p) => [p.title, p.text]),
            ...v.faq.flatMap((p) => [p.question, p.answer]),
          ].every((s) => s.trim().length > 0 && s.length <= 8000) &&
          v.faq.length >= 1 &&
          v.faq.length <= 20 &&
          v.benefits.length <= 20,
        "Заполните тексты и от 1 до 20 вопросов FAQ.",
      ),
  })
  .strict();
export const billingTextInput = z
  .object({ revision, value: billingContentSchema.strict() })
  .strict();
function stale() {
  throw new ContentError(
    "Данные уже изменены. Обновите страницу перед сохранением.",
    409,
  );
}
export async function configuration(actorId: string) {
  await assertAdmin(actorId);
  const [plans, settings, content, documents] = await Promise.all([
    getDb().plan.findMany({ orderBy: [{ order: "asc" }, { code: "asc" }] }),
    getDb().appSetting.findMany(),
    getDb().landingContent.findMany({
      where: { key: { in: ["landing.v1", "billing.v1"] } },
    }),
    getDb().legalDocument.findMany({
      where: { publishedAt: { lte: new Date() } },
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
    }),
  ]);
  const landing = content.find((r) => r.key === "landing.v1"),
    billing = content.find((r) => r.key === "billing.v1");
  return {
    plans,
    settings: editableSettingKeys.map((key) => ({
      key,
      value:
        settings.find((r) => r.key === key)?.value ?? DEFAULT_SETTINGS[key],
      revision:
        settings.find((r) => r.key === key)?.updatedAt.toISOString() ?? null,
    })),
    landing: {
      revision: landing?.updatedAt.toISOString() ?? null,
      value: landingSchema.safeParse(landing?.value).data ?? LANDING_DEFAULTS,
    },
    billing: {
      revision: billing?.updatedAt.toISOString() ?? null,
      value:
        billingContentSchema.safeParse(billing?.value).data ?? BILLING_CONTENT,
    },
    documents: documents.map((d) => ({
      ...d,
      publishedAt: d.publishedAt.toISOString(),
    })),
  };
}
export async function savePlan(actorId: string, id: string, raw: unknown) {
  const data = planInput.parse(raw);
  return adminWrite(actorId, async (tx) => {
    const before = await tx.plan.findUniqueOrThrow({ where: { id } });
    if (before.editRevision !== data.revision) stale();
    if (
      before.kind === "FREE"
        ? data.priceKopecks !== 0 || !data.isActive
        : data.priceKopecks <= 0
    )
      throw new ContentError(
        "Бесплатный тариф должен оставаться активным с нулевой ценой; платные тарифы требуют положительную цену.",
      );
    const { revision: _, ...fields } = data;
    void _;
    const result = await tx.plan.update({
      where: { id },
      data: { ...fields, editRevision: { increment: 1 } },
    });
    await adminAudit(tx, actorId, "PLAN_CHANGED", {
      planId: id,
      before: {
        title: before.title,
        priceKopecks: before.priceKopecks,
        tutorDailyLimit: before.tutorDailyLimit,
        isActive: before.isActive,
        features: before.features,
        order: before.order,
      },
      after: fields,
    });
    return result;
  });
}
export async function saveSetting(actorId: string, raw: unknown) {
  const data = settingInput.parse(raw),
    key = data.key as SettingKey;
  return adminWrite(actorId, async (tx) => {
    const before = await tx.appSetting.findUnique({ where: { key } });
    if ((before?.updatedAt.toISOString() ?? null) !== data.revision) stale();
    const all = Object.fromEntries(
      (await tx.appSetting.findMany()).map((r) => [r.key, r.value]),
    );
    const values = { ...DEFAULT_SETTINGS, ...all, [key]: data.value };
    if (
      Number(values["content.minQuestions"]) >
        Number(values["content.maxQuestions"]) ||
      Number(values["tutor.chunkTargetTokens"]) >
        Number(values["tutor.chunkMaxTokens"]) ||
      Number(values["srs.easeMin"]) > Number(values["srs.easeDefault"]) ||
      Number(values["admin.defaultGrantDays"]) >
        Number(values["admin.maxGrantDays"])
    )
      throw new ContentError(
        "Связанные настройки противоречат друг другу: минимум не может превышать максимум.",
      );
    const row = await tx.appSetting.upsert({
      where: { key },
      create: { key, value: data.value },
      update: { value: data.value },
    });
    await adminAudit(tx, actorId, "SETTING_CHANGED", {
      key,
      before: before?.value ?? null,
      after: data.value,
    });
    return { key, value: row.value, revision: row.updatedAt.toISOString() };
  });
}
async function saveText(
  actorId: string,
  key: string,
  expected: string | null,
  value: Prisma.InputJsonObject,
) {
  return adminWrite(actorId, async (tx) => {
    const before = await tx.landingContent.findUnique({ where: { key } });
    if ((before?.updatedAt.toISOString() ?? null) !== expected) stale();
    let next = value;
    if (key === "landing.v1") {
      const existing =
        landingSchema.safeParse(before?.value).data ?? LANDING_DEFAULTS;
      next = { ...value, examples: existing.examples };
    } else {
      const existing =
        billingContentSchema.safeParse(before?.value).data ?? BILLING_CONTENT;
      if (
        existing.renewal !== value.renewal &&
        existing.version === value.version
      )
        throw new ContentError(
          "При изменении согласия на автопродление укажите новую версию.",
        );
    }
    const row = await tx.landingContent.upsert({
      where: { key },
      create: { key, value: next },
      update: { value: next },
    });
    await adminAudit(tx, actorId, "PUBLIC_TEXT_CHANGED", {
      key,
      before: before?.value ?? null,
      after: next,
    });
    return { revision: row.updatedAt.toISOString() };
  });
}
export async function saveLanding(actorId: string, raw: unknown) {
  const data = landingInput.parse(raw);
  return saveText(actorId, "landing.v1", data.revision, data.value);
}
export async function saveBillingText(actorId: string, raw: unknown) {
  const data = billingTextInput.parse(raw);
  return saveText(actorId, "billing.v1", data.revision, data.value);
}
export async function publishLegal(actorId: string, raw: unknown) {
  const data = legalInput.parse(raw);
  return adminWrite(actorId, async (tx) => {
    const before = await tx.legalDocument.findFirst({
      where: { kind: data.kind, publishedAt: { lte: new Date() } },
      orderBy: [{ publishedAt: "desc" }, { version: "desc" }],
    });
    if ((before?.id ?? null) !== data.previousId) stale();
    if (
      await tx.legalDocument.count({
        where: { kind: data.kind, version: data.version },
      })
    )
      throw new ContentError(
        "Такая версия уже есть. Создайте новую версию документа.",
        409,
      );
    const row = await tx.legalDocument.create({
      data: {
        kind: data.kind,
        version: data.version,
        contentMd: data.contentMd,
        publishedAt: new Date(
          Math.max(Date.now(), (before?.publishedAt.getTime() ?? 0) + 1),
        ),
      },
    });
    await adminAudit(tx, actorId, "LEGAL_VERSION_PUBLISHED", {
      kind: data.kind,
      version: data.version,
      documentId: row.id,
      previousId: data.previousId,
    });
    return { id: row.id };
  });
}
