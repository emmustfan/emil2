import { NextRequest } from "next/server";
import { z } from "zod";
import { assertOrigin, readInput } from "@/lib/auth/http";
import { contentJSON, contentFailure } from "@/lib/content/http";
import { requireBuyer } from "@/lib/billing/http";
import { requestRefund } from "@/lib/billing/refunds";
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> },
) {
  try {
    assertOrigin(request);
    const admin = await requireBuyer(true);
    z.object({ confirm: z.literal(true) })
      .strict()
      .parse(await readInput(request));
    return contentJSON(await requestRefund(admin.id, (await params).paymentId));
  } catch (e) {
    return contentFailure(e);
  }
}
