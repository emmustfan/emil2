import { assertOrigin, clientIp, readInput } from "@/lib/auth/http";
import { AuthError } from "@/lib/auth/errors";
import { hasCurrentConsent } from "@/lib/auth/legal";
import { getCurrentSession } from "@/lib/auth/server";
import {
  contentFailure,
  contentJSON,
  requireContentEditor,
} from "@/lib/content/http";
import { groupId } from "@/lib/groups/input";
import {
  createGroup,
  changeGroup,
  GROUP_CSV_BYTES,
  importGroups,
  joinGroup,
  leaveGroup,
} from "@/lib/groups/service";
import { groupMissing } from "@/lib/org/groups";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    assertOrigin(request);
    const [action, id, extra] = (await params).path;
    if (extra || (id && !groupId.safeParse(id).success)) throw groupMissing();
    if ((action === "join" && !id) || (action === "leave" && id)) {
      const session = await getCurrentSession();
      if (!session) throw new AuthError("unauthorized", 401);
      if (!(await hasCurrentConsent(session.user)))
        throw new AuthError("forbidden", 403);
      const actor = { id: session.userId, readOnly: !!session.readOnly };
      return contentJSON(
        id
          ? await leaveGroup(actor, id)
          : await joinGroup(actor, clientIp(request), await readInput(request)),
      );
    }
    const actor = await requireContentEditor();
    if (actor.readOnly) throw new AuthError("forbidden", 403);
    if (action === "create" && !id)
      return contentJSON(
        await createGroup(actor, await readInput(request)),
        201,
      );
    if (action === "import" && !id)
      return contentJSON(
        await importGroups(
          actor,
          await readInput(request, GROUP_CSV_BYTES * 6 + 1024),
        ),
      );
    if (action === "manage" && id)
      return contentJSON(
        await changeGroup(actor, id, await readInput(request)),
      );
    throw groupMissing();
  } catch (error) {
    return contentFailure(error);
  }
}
