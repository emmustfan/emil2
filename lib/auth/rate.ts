import { getDb } from "../db";
import { getSetting } from "../settings";
import { lock } from "./session";
import { AuthError } from "./errors";
export async function consumeAuthAttempt(key: string) {
  const max = await getSetting("auth.ipMaxRequests");
  const minutes = await getSetting("auth.ipWindowMinutes");
  await getDb().$transaction(async (tx) => {
    await lock(tx, `attempt:${key}`);
    const count = await tx.authAttempt.count({
      where: {
        key,
        createdAt: { gte: new Date(Date.now() - minutes * 60000) },
      },
    });
    if (count >= max) throw new AuthError("rate", 429);
    await tx.authAttempt.create({ data: { key } });
  });
}
