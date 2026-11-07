import { assertOrigin, readInput } from "@/lib/auth/http";
import { contentJSON, contentFailure } from "@/lib/content/http";
import { reviewUser, reviewInput, cardIdSchema } from "@/lib/srs/http";
import { revealCard, rateCard } from "@/lib/srs/service";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ cardId: string }> },
) {
  try {
    assertOrigin(request);
    const user = await reviewUser(),
      input = reviewInput.parse(await readInput(request)),
      { cardId } = await params;
    cardIdSchema.parse(cardId);
    return contentJSON(
      input.action === "reveal"
        ? await revealCard(user.id, cardId, input.revision, input.topicVersion)
        : await rateCard(
            user.id,
            cardId,
            input.revision,
            input.topicVersion,
            input.rating,
          ),
    );
  } catch (error) {
    return contentFailure(error);
  }
}
