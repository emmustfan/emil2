import { NextRequest } from "next/server";
import { assertOrigin, readInput } from "@/lib/auth/http";
import { contentJSON, contentFailure } from "@/lib/content/http";
import { requireBuyer } from "@/lib/billing/http";
import { cancelSubscription } from "@/lib/billing/service";
import { z } from "zod";
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ subscriptionId: string }> },
) {
  try {
    assertOrigin(request);
    z.object({ confirm: z.literal(true) })
      .strict()
      .parse(await readInput(request));
    const user = await requireBuyer();
    await cancelSubscription(user.id, (await params).subscriptionId);
    return contentJSON({ ok: true });
  } catch (e) {
    return contentFailure(e);
  }
}
