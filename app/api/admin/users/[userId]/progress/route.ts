import { getCurrentSession } from "@/lib/auth/server";
import { contentJSON, contentFailure } from "@/lib/content/http";
import { studentProgress } from "@/lib/progress/student";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const { userId } = await params;
    return contentJSON(
      await studentProgress(userId, {
        viewerId: (await getCurrentSession())?.user.id,
        subjectId:
          new URL(request.url).searchParams.get("subjectId") || undefined,
      }),
    );
  } catch (e) {
    return contentFailure(e);
  }
}
