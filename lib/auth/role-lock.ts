import type { Prisma } from "../generated/prisma/client";
export const ROLE_LOCK = "security:roles";
export async function lockRoleAccess(
  tx: Prisma.TransactionClient,
  exclusive = false,
) {
  if (exclusive)
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ROLE_LOCK},0))`;
  else
    await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${ROLE_LOCK},0))`;
}
