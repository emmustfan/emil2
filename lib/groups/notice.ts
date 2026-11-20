import { getDb } from "../db";
import type { Prisma } from "../generated/prisma/client";

export const GROUP_NOTICE_KIND = "group-notice";

export function currentGroupNotice(db: Prisma.TransactionClient = getDb()) {
  return db.legalDocument.findFirst({
    where: { kind: GROUP_NOTICE_KIND, publishedAt: { lte: new Date() } },
    orderBy: [{ publishedAt: "desc" }, { version: "desc" }],
    select: { version: true, contentMd: true },
  });
}
