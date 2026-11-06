import { getDb } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await getDb().$queryRaw`SELECT 1`;
    return Response.json({ status: "ok", database: "ok" });
  } catch {
    return Response.json(
      { status: "unavailable", database: "unavailable" },
      { status: 503 },
    );
  }
}
