import { Prisma } from "../generated/prisma/client";
import { getDb } from "../db";
import { assertAdmin } from "./users";
import { reportInput, reportRange, conversion } from "./policy";
import { ContentError } from "../content/errors";
const activities = [
  "gap_answered",
  "test_completed",
  "review_session_completed",
  "tutor_message_sent",
];
export async function dashboard(
  actorId: string,
  raw: unknown,
  now = new Date(),
) {
  await assertAdmin(actorId);
  const input = reportInput.parse(raw);
  let range: ReturnType<typeof reportRange>;
  try {
    range = reportRange(input, now);
  } catch {
    throw new ContentError("Выберите корректный период не длиннее года.");
  }
  const { start, end } = range,
    source = input.source,
    matchSource = source === "__direct__" ? "" : source,
    unfiltered = source === "";
  const [funnel, revenue, subscriptions, retention, sources] =
    await Promise.all([
      getDb().$queryRaw<{ name: string; n: bigint }[]>(Prisma.sql`
      WITH visits AS (
        SELECT e.*,COALESCE(u.utm->>'utm_source',e.props->'utm'->>'utm_source',
          (SELECT d.utm->>'utm_source' FROM "DemoSession" d WHERE d."anonId"=e."anonId" ORDER BY d."createdAt" DESC LIMIT 1),'') source
        FROM "Event" e LEFT JOIN "User" u ON u.id=e."userId"
        WHERE e."createdAt">=${start} AND e."createdAt"<${end}
      ) SELECT name,COUNT(DISTINCT COALESCE('user:'||"userId",'anon:'||"anonId")) n FROM visits
        WHERE (${unfiltered} OR source=${matchSource}) AND name IN ('landing_viewed','demo_started','demo_completed','signup_completed','payment_succeeded')
        GROUP BY name`),
      getDb().$queryRaw<{ gross: bigint; refunds: bigint }[]>(Prisma.sql`
      SELECT COALESCE(SUM(CASE WHEN p."paidAt">=${start} AND p."paidAt"<${end} AND p.status IN ('SUCCEEDED','REFUNDED') THEN p."amountKopecks" ELSE 0 END),0)::bigint gross,
        COALESCE(SUM(CASE WHEN p."refundedAt">=${start} AND p."refundedAt"<${end} AND p.status='REFUNDED' THEN p."amountKopecks" ELSE 0 END),0)::bigint refunds
        FROM "Payment" p JOIN "User" u ON u.id=p."userId" WHERE (${unfiltered} OR COALESCE(u.utm->>'utm_source','')=${matchSource})`),
      getDb().$queryRaw<{ active: bigint; mrr: number }[]>(Prisma.sql`
      SELECT COUNT(*) active,COALESCE(SUM(CASE WHEN s."autoRenew" THEN s."priceKopecks"::float / GREATEST(s."periodMonths",1) ELSE 0 END),0)::float mrr
      FROM "Subscription" s JOIN "User" u ON u.id=s."userId" WHERE u."deletedAt" IS NULL AND u."blockedAt" IS NULL
        AND s."revokedAt" IS NULL AND s.status='ACTIVE' AND s."currentPeriodEnd">${now}
        AND (${unfiltered} OR COALESCE(u.utm->>'utm_source','')=${matchSource})`),
      getDb().$queryRaw<
        { day: number; mature: bigint; retained: bigint }[]
      >(Prisma.sql`
      SELECT days.day,COUNT(*) FILTER(WHERE date_trunc('day',u."createdAt")+(days.day+1)*interval '1 day' <=${now}) mature,
        COUNT(*) FILTER(WHERE date_trunc('day',u."createdAt")+(days.day+1)*interval '1 day' <=${now} AND EXISTS(
          SELECT 1 FROM "Event" e WHERE e."userId"=u.id AND e.name IN (${Prisma.join(activities)})
            AND e."createdAt">=date_trunc('day',u."createdAt")+days.day*interval '1 day'
            AND e."createdAt"<date_trunc('day',u."createdAt")+(days.day+1)*interval '1 day')) retained
      FROM (VALUES(1),(7)) days(day) CROSS JOIN "User" u WHERE u."createdAt">=${start} AND u."createdAt"<${end} AND u."deletedAt" IS NULL
        AND (${unfiltered} OR COALESCE(u.utm->>'utm_source','')=${matchSource}) GROUP BY days.day ORDER BY days.day`),
      getDb().$queryRaw<
        { source: string; payments: bigint; gross: bigint; refunds: bigint }[]
      >(Prisma.sql`
      SELECT COALESCE(u.utm->>'utm_source','') source,COUNT(*) FILTER(WHERE p."paidAt">=${start} AND p."paidAt"<${end}) payments,
        COALESCE(SUM(CASE WHEN p."paidAt">=${start} AND p."paidAt"<${end} THEN p."amountKopecks" ELSE 0 END),0)::bigint gross,
        COALESCE(SUM(CASE WHEN p."refundedAt">=${start} AND p."refundedAt"<${end} THEN p."amountKopecks" ELSE 0 END),0)::bigint refunds
      FROM "Payment" p JOIN "User" u ON u.id=p."userId" WHERE p.status IN ('SUCCEEDED','REFUNDED')
        AND ((p."paidAt">=${start} AND p."paidAt"<${end}) OR (p."refundedAt">=${start} AND p."refundedAt"<${end}))
        AND (${unfiltered} OR COALESCE(u.utm->>'utm_source','')=${matchSource}) GROUP BY COALESCE(u.utm->>'utm_source','') ORDER BY gross DESC,source ASC`),
    ]);
  const names = [
      "landing_viewed",
      "demo_started",
      "demo_completed",
      "signup_completed",
      "payment_succeeded",
    ],
    counts = names.map((name) =>
      Number(funnel.find((r) => r.name === name)?.n ?? 0),
    );
  return {
    range,
    source,
    funnel: names.map((name, i) => ({
      name,
      count: counts[i],
      conversion: i ? conversion(counts[i], counts[i - 1]) : null,
    })),
    gross: Number(revenue[0]?.gross ?? 0),
    refunds: Number(revenue[0]?.refunds ?? 0),
    net: Number(revenue[0]?.gross ?? 0) - Number(revenue[0]?.refunds ?? 0),
    active: Number(subscriptions[0]?.active ?? 0),
    mrr: Math.round(subscriptions[0]?.mrr ?? 0),
    retention: [1, 7].map((day) => {
      const r = retention.find((r) => r.day === day),
        mature = Number(r?.mature ?? 0),
        retained = Number(r?.retained ?? 0);
      return { day, mature, retained, percent: conversion(retained, mature) };
    }),
    sources: sources.map((r) => ({
      source: r.source,
      payments: Number(r.payments),
      gross: Number(r.gross),
      refunds: Number(r.refunds),
      net: Number(r.gross) - Number(r.refunds),
    })),
  };
}
