import { LearningShell } from "@/components/lessons/shell";
import { LandingPlans } from "@/components/landing/plans";
import { landingContent } from "@/lib/landing/content";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Тарифы",
  robots: { index: true, follow: true },
};
export default async function Pricing() {
  const content = await landingContent();
  return (
    <LearningShell>
      <h1 className="text-3xl font-semibold">Выберите формат обучения</h1>
      <LandingPlans note={content.paymentNote} />
    </LearningShell>
  );
}
