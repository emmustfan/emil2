import { getDb } from "../db";
import { decodeSetting } from "../settings/defaults";
import { reportFault } from "./index";
export type UsageKind = "tutor" | "import" | "embedding";
export function estimateCost(
  kind: UsageKind,
  tokensIn: number | null,
  tokensOut: number | null,
  prices: { input: number; output: number; embedding: number },
) {
  if (
    tokensIn === null ||
    tokensOut === null ||
    ![tokensIn, tokensOut].every(
      (n) => Number.isInteger(n) && n >= 0 && n <= 100000000,
    )
  )
    return null;
  if (kind === "embedding")
    return prices.embedding > 0
      ? (tokensIn * prices.embedding) / 1000000
      : null;
  return prices.input > 0 || prices.output > 0
    ? (tokensIn * prices.input + tokensOut * prices.output) / 1000000
    : null;
}
export async function recordUsage(
  kind: UsageKind,
  model: string,
  tokensIn: number | null,
  tokensOut: number | null,
) {
  const db = getDb(),
    rows = await db.appSetting.findMany({
      where: { key: { startsWith: "llm." } },
    });
  const input = decodeSetting(
      "llm.inputRubPerMillion",
      rows.find((r) => r.key === "llm.inputRubPerMillion")?.value,
    ),
    output = decodeSetting(
      "llm.outputRubPerMillion",
      rows.find((r) => r.key === "llm.outputRubPerMillion")?.value,
    ),
    embedding = decodeSetting(
      "llm.embeddingRubPerMillion",
      rows.find((r) => r.key === "llm.embeddingRubPerMillion")?.value,
    );
  const cost = estimateCost(kind, tokensIn, tokensOut, {
    input,
    output,
    embedding,
  });
  await db.llmUsage.create({
    data: {
      kind,
      model: model.slice(0, 200),
      tokensIn,
      tokensOut,
      estimatedCostRub: cost === null ? null : cost.toFixed(8),
    },
  });
}
export async function meterUsage(
  kind: UsageKind,
  model: string,
  tokensIn: number | null,
  tokensOut: number | null,
) {
  if (process.env.NODE_ENV === "test") return;
  try {
    await recordUsage(kind, model, tokensIn, tokensOut);
  } catch (error) {
    console.error("llm_metering_failed");
    await reportFault("llm_metering_failed", error);
  }
}
export async function spendSummary(
  start = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z"),
  end = new Date(start.getTime() + 86400000),
) {
  const db = getDb(),
    where = { createdAt: { gte: start, lt: end } };
  const [totals, unknown] = await Promise.all([
    db.llmUsage.aggregate({
      where,
      _sum: { estimatedCostRub: true, tokensIn: true, tokensOut: true },
      _count: true,
    }),
    db.llmUsage.count({ where: { ...where, estimatedCostRub: null } }),
  ]);
  return {
    estimatedRub: Number(totals._sum.estimatedCostRub ?? 0),
    requests: totals._count,
    unknown,
    tokensIn: totals._sum.tokensIn ?? 0,
    tokensOut: totals._sum.tokensOut ?? 0,
  };
}
export async function budgetTick() {
  const budget = Number(process.env.LLM_DAILY_BUDGET_RUB ?? 1000),
    summary = await spendSummary();
  if (Number.isFinite(budget) && budget > 0 && summary.estimatedRub >= budget)
    await reportFault("llm_budget_exceeded");
}
