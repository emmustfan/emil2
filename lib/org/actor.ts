import { cache } from "react";
import { AuthError } from "../auth/errors";
import { getDb } from "../db";
import type { Prisma } from "../generated/prisma/client";
import type { StaffActor } from "./policy";

type Db = Prisma.TransactionClient;
export type ContentReader = string | { id: string; readOnly?: boolean };

async function loadActor(
  db: Db,
  id: string,
  readOnly: boolean,
): Promise<StaffActor> {
  const row = await db.user.findUnique({
    where: { id },
    select: {
      id: true,
      role: true,
      blockedAt: true,
      deletedAt: true,
      staffAssignments: {
        select: {
          role: true,
          facultyId: true,
          departmentId: true,
          subjectId: true,
        },
      },
    },
  });
  if (!row || row.deletedAt || (row.blockedAt && !readOnly))
    throw new AuthError("unauthorized", 401);
  return {
    id: row.id,
    role: row.role,
    assignments: row.staffAssignments,
    readOnly,
  };
}

const cachedActor = cache((id: string, readOnly: boolean) =>
  loadActor(getDb(), id, readOnly),
);
const requestActors = new WeakMap<object, Promise<StaffActor>>();
export function orgActor(actor: ContentReader, db?: Db) {
  const id = typeof actor === "string" ? actor : actor.id;
  const readOnly = typeof actor === "object" && actor.readOnly === true;
  if (db && db !== getDb()) return loadActor(db, id, readOnly);
  if (typeof actor === "string") return cachedActor(id, readOnly);
  const existing = requestActors.get(actor);
  if (existing) return existing;
  const loaded = cachedActor(id, readOnly);
  requestActors.set(actor, loaded);
  return loaded;
}
