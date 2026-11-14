import type { Prisma } from "../generated/prisma/client";

/**
 * Lock order (transaction-scoped advisory locks):
 * - learning: learning:<actor> exclusively, then content:topic:<id> shared;
 * - changes: topic:<id> exclusively (editor), then content:topic:<id> exclusively.
 * lockTopicForChange acquires BOTH writer locks in that order. Never upgrade a
 * learning lock to a change lock. For several topics, acquire IDs in sorted order.
 * The actor lock still serializes actions of ONE learner, not the entire class.
 */
export async function lockTopicForLearning(
  tx: Prisma.TransactionClient,
  topicId: string,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${`content:topic:${topicId}`}, 0))`;
}

export async function lockTopicForChange(
  tx: Prisma.TransactionClient,
  topicId: string,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`topic:${topicId}`}, 0))`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`content:topic:${topicId}`}, 0))`;
}
