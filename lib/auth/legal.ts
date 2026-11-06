import { getDb } from "../db";
export async function currentLegal() {
  const documents = await getDb().legalDocument.findMany({
    where: {
      kind: { in: ["consent", "oferta"] },
      publishedAt: { lte: new Date() },
    },
    orderBy: [{ publishedAt: "desc" }, { version: "desc" }],
  });
  const consent = documents.find((d) => d.kind === "consent");
  const offer = documents.find((d) => d.kind === "oferta");
  if (!consent || !offer)
    throw new Error("Legal documents are not configured; run db:seed");
  return { consent, offer };
}
export async function hasCurrentConsent(user: {
  consentPdAt: Date | null;
  consentPdVersion: string | null;
  offerVersion: string | null;
}) {
  const { consent, offer } = await currentLegal();
  return (
    !!user.consentPdAt &&
    user.consentPdVersion === consent.version &&
    user.offerVersion === offer.version
  );
}
