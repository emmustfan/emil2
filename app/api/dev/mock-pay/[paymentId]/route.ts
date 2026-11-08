import { NextRequest } from "next/server";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { getDb } from "@/lib/db";
import { AuthError } from "@/lib/auth/errors";
import { assertOrigin, readInput } from "@/lib/auth/http";
import { contentJSON, contentFailure } from "@/lib/content/http";
import { requireBuyer } from "@/lib/billing/http";
import { settleMockPayment } from "@/lib/billing/worker";
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> },
) {
  try {
    assertOrigin(request);
    if (
      getEnv().PAYMENTS_PROVIDER !== "mock" ||
      getEnv().NODE_ENV === "production"
    )
      throw new AuthError("forbidden", 403);
    const user = await requireBuyer(),
      id = (await params).paymentId;
    if (
      !(await getDb().payment.findFirst({
        where: { id, userId: user.id, provider: "mock" },
      }))
    )
      throw new AuthError("forbidden", 403);
    const input = z
      .object({ status: z.enum(["succeeded", "canceled"]) })
      .strict()
      .parse(await readInput(request));
    await settleMockPayment(id, input.status, user.id);
    return contentJSON({ redirect: `/checkout/return?paymentId=${id}` });
  } catch (e) {
    return contentFailure(e);
  }
}
