import { z } from "zod";
import { revalidatePath } from "next/cache";
import { assertOrigin, readInput } from "@/lib/auth/http";
import { adminActor } from "@/lib/admin/http";
import {
  getManagedUser,
  updateUserAccess,
  accessInput,
} from "@/lib/admin/users";
import { contentJSON, contentFailure } from "@/lib/content/http";
type Context = { params: Promise<{ userId: string }> };
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export async function GET(_request: Request, { params }: Context) {
  try {
    const actor = await adminActor(),
      { userId } = await params;
    return contentJSON(await getManagedUser(actor.id, id.parse(userId)));
  } catch (e) {
    return contentFailure(e);
  }
}
export async function PATCH(request: Request, { params }: Context) {
  try {
    assertOrigin(request);
    const actor = await adminActor(),
      { userId } = await params,
      input = accessInput.parse(await readInput(request, 64000));
    const result = await updateUserAccess(actor.id, id.parse(userId), input);
    revalidatePath("/admin", "layout");
    revalidatePath("/teacher");
    revalidatePath("/cabinet");
    return contentJSON(result);
  } catch (e) {
    return contentFailure(e);
  }
}
