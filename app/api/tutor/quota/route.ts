import { contentJSON, contentFailure } from "@/lib/content/http";
import { lessonActor } from "@/lib/lessons/actor";
import { getTutorQuota } from "@/lib/tutor/quota";
export async function GET() {
  try {
    return contentJSON(await getTutorQuota(await lessonActor()));
  } catch (error) {
    return contentFailure(error);
  }
}
