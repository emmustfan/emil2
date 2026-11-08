import { getDb } from "../db";
import type { Prisma } from "../generated/prisma/client";
import { lockRoleAccess } from "../auth/role-lock";
import { lock } from "../auth/session";
import { assertAdmin } from "./users";
export async function adminWrite<T>(
  actorId: string,
  run: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  return getDb().$transaction(
    async (tx) => {
      await lockRoleAccess(tx);
      await assertAdmin(actorId, tx);
      await lock(tx, "admin:configuration");
      return run(tx);
    },
    { timeout: 15000 },
  );
}
export async function adminAudit(
  tx: Prisma.TransactionClient,
  actorId: string,
  action: string,
  changes: Prisma.InputJsonObject,
  targetId?: string,
) {
  await tx.securityAudit.create({
    data: { actorId, action, changes, targetId },
  });
}
