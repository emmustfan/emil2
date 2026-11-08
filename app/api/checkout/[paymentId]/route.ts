import { NextRequest } from "next/server";
import { contentJSON, contentFailure } from "@/lib/content/http";
import { requireBuyer } from "@/lib/billing/http";
import { paymentStatus } from "@/lib/billing/service";
import { consumeLimit } from "@/lib/access";
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> },
) {
  try {
    const user = await requireBuyer();
    await consumeLimit(`billing-status:${user.id}`);
    return contentJSON(await paymentStatus(user.id, (await params).paymentId));
  } catch (e) {
    return contentFailure(e);
  }
}
