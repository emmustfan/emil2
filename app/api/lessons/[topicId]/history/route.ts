import { getCurrentSession } from "@/lib/auth/server";
import { hasCurrentConsent } from "@/lib/auth/legal";
import { contentJSON, contentFailure } from "@/lib/content/http";
import { gapHistory } from "@/lib/lessons/history";
import { ContentError } from "@/lib/content/errors";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ topicId: string }> },
) {
  try {
    const session = await getCurrentSession();
    if (!session || !(await hasCurrentConsent(session.user)))
      throw new ContentError("Данные не найдены.", 404);
    const { topicId } = await params;
    return contentJSON(
      await gapHistory(topicId, session.user.id, session.readOnly),
    );
  } catch (e) {
    return contentFailure(e);
  }
}
