import { NextRequest } from "next/server";
import { assertOrigin, readInput } from "@/lib/auth/http";
import { contentJSON, contentFailure } from "@/lib/content/http";
import { requireBuyer } from "@/lib/billing/http";
import { startCheckout } from "@/lib/billing/service";
export async function POST(request: NextRequest) {
  try {
    assertOrigin(request);
    const user = await requireBuyer();
    return contentJSON(await startCheckout(user.id, await readInput(request)));
  } catch (e) {
    return contentFailure(e);
  }
}
