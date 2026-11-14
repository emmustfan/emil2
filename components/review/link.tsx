import { cache } from "react";
import { getCurrentSession } from "@/lib/auth/server";
import { hasCurrentConsent } from "@/lib/auth/legal";
import { getReviewSummary } from "@/lib/srs/service";
import { ReviewBadge } from "./badge";
export const currentReviewSummary = cache(async () => {
  const session = await getCurrentSession();
  if (!session || !(await hasCurrentConsent(session.user))) return null;
  return getReviewSummary(session.userId);
});
export async function ReviewLink() {
  const summary = await currentReviewSummary();
  return summary ? (
    <ReviewBadge key={summary.dueCount} initialCount={summary.dueCount} />
  ) : null;
}
