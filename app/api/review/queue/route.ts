import { contentJSON, contentFailure } from "@/lib/content/http";
import { reviewUser } from "@/lib/srs/http";
import { getReviewQueue, getReviewSummary } from "@/lib/srs/service";
export async function GET(request: Request) {
  try {
    const user = await reviewUser();
    return contentJSON(
      new URL(request.url).searchParams.get("summary") === "1"
        ? await getReviewSummary(user.id)
        : await getReviewQueue(user.id),
    );
  } catch (error) {
    return contentFailure(error);
  }
}
