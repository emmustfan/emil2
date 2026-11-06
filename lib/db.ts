import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";
import { getEnv } from "./env";
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
// Do not open connections or require runtime secrets during next build.
export function getDb(): PrismaClient {
  globalForPrisma.prisma ??= new PrismaClient({
    adapter: new PrismaPg({ connectionString: getEnv().DATABASE_URL }),
  });
  return globalForPrisma.prisma;
}
