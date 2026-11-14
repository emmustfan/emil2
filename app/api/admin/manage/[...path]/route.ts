import { assertOrigin, readInput } from "@/lib/auth/http";
import { adminActor } from "@/lib/admin/http";
import { identifier } from "@/lib/admin/policy";
import {
  savePlan,
  saveSetting,
  saveLanding,
  saveBillingText,
  publishLegal,
} from "@/lib/admin/settings";
import { grantAccess, revokeGrant } from "@/lib/admin/grants";
import { contentJSON, contentFailure } from "@/lib/content/http";
import { ContentError } from "@/lib/content/errors";
import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    assertOrigin(request);
    const actor = await adminActor(),
      { path } = await params,
      input = await readInput(request, 128000);
    let result: unknown;
    if (path.length === 2 && path[0] === "plans")
      result = await savePlan(actor.id, identifier.parse(path[1]), input);
    else if (path.length === 1 && path[0] === "settings")
      result = await saveSetting(actor.id, input);
    else if (path.length === 1 && path[0] === "landing")
      result = await saveLanding(actor.id, input);
    else if (path.length === 1 && path[0] === "billing-text")
      result = await saveBillingText(actor.id, input);
    else if (path.length === 1 && path[0] === "legal")
      result = await publishLegal(actor.id, input);
    else if (path.length === 2 && path[0] === "grants")
      result = await grantAccess(actor.id, identifier.parse(path[1]), input);
    else if (path.length === 3 && path[0] === "grants") {
      z.object({ confirm: z.literal(true) })
        .strict()
        .parse(input);
      await revokeGrant(
        actor.id,
        identifier.parse(path[1]),
        identifier.parse(path[2]),
      );
      result = { ok: true };
    } else throw new ContentError("Страница не найдена.", 404);
    revalidateTag("app-settings", { expire: 0 });
    for (const p of ["/admin", "/teacher", "/cabinet"])
      revalidatePath(p, "layout");
    revalidatePath("/");
    revalidatePath("/pricing");
    return contentJSON(result);
  } catch (e) {
    return contentFailure(e);
  }
}
