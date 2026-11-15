import { getCurrentSession } from "@/lib/auth/server";
import { contentJSON, contentFailure } from "@/lib/content/http";
import { progressSummary } from "@/lib/progress/summary";
export async function GET(request: Request) {
  try {
    return contentJSON(
      await progressSummary({
        ...Object.fromEntries(new URL(request.url).searchParams),
        viewerId: (await getCurrentSession())?.user.id,
      }),
    );
  } catch (e) {
    return contentFailure(e);
  }
}
