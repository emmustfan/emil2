import { assertOrigin, readInput } from "@/lib/auth/http";
import { requireBuyer } from "@/lib/billing/http";
import {
  resumeRenewal,
  unlinkPaymentMethod,
  manualRenewal,
} from "@/lib/billing/manage";
import { contentJSON, contentFailure } from "@/lib/content/http";
import { identifier } from "@/lib/admin/policy";
import { z } from "zod";
import { revalidatePath } from "next/cache";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ subscriptionId: string }> },
) {
  try {
    assertOrigin(request);
    const user = await requireBuyer(),
      { subscriptionId } = await params,
      id = identifier.parse(subscriptionId);
    const input = z
      .object({
        action: z.enum(["resume", "unlink", "pay"]),
        data: z.unknown(),
      })
      .strict()
      .parse(await readInput(request));
    let result: unknown = { ok: true };
    if (input.action === "resume") await resumeRenewal(user.id, id, input.data);
    else {
      z.object({ confirm: z.literal(true) })
        .strict()
        .parse(input.data);
      if (input.action === "unlink") await unlinkPaymentMethod(user.id, id);
      else result = await manualRenewal(user.id, id);
    }
    revalidatePath("/cabinet/subscription");
    return contentJSON(result);
  } catch (e) {
    return contentFailure(e);
  }
}
