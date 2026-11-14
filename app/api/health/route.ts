import { getDb } from "@/lib/db";
import { workerIsReady } from "@/lib/monitoring/health";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
export async function GET() {
  try {
    const db = getDb();
    await db.$queryRaw`SELECT 1`;
    const worker =
      process.env.NODE_ENV !== "production" ||
      workerIsReady(
        (
          await db.appSetting.findUnique({
            where: { key: "ops.workerHeartbeat" },
          })
        )?.value,
      );
    return Response.json(
      {
        status: worker ? "ok" : "unavailable",
        database: "ok",
        worker: worker ? "ok" : "unavailable",
      },
      { status: worker ? 200 : 503, headers },
    );
  } catch {
    return Response.json(
      { status: "unavailable", database: "unavailable" },
      { status: 503, headers },
    );
  }
}
