import { adminActor } from "@/lib/admin/http";
import { listUsers, userFilters } from "@/lib/admin/users";
import { contentJSON, contentFailure } from "@/lib/content/http";
export async function GET(request: Request) {
  try {
    const user = await adminActor();
    return contentJSON(
      await listUsers(
        user.id,
        userFilters.parse(
          Object.fromEntries(new URL(request.url).searchParams),
        ),
      ),
    );
  } catch (e) {
    return contentFailure(e);
  }
}
