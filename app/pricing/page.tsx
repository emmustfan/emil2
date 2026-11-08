import { LearningShell } from "@/components/lessons/shell";
import { Checkout } from "@/components/billing/checkout";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { getCurrentSession } from "@/lib/auth/server";
import { currentLegal } from "@/lib/auth/legal";
import { billingContent } from "@/lib/billing/config";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Тарифы",
  robots: { index: true, follow: true },
};
export default async function Pricing({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; subject?: string }>;
}) {
  const [p, user, content, legal, plans, subjects] = await Promise.all([
    searchParams,
    getCurrentSession(),
    billingContent(),
    currentLegal(),
    getDb().plan.findMany({
      where: { isActive: true, kind: { in: ["SUBJECT", "ALL_SUBJECTS"] } },
      orderBy: { order: "asc" },
      select: {
        code: true,
        title: true,
        kind: true,
        priceKopecks: true,
        periodMonths: true,
        features: true,
      },
    }),
    getDb().subject.findMany({
      where: { status: "PUBLISHED" },
      orderBy: { title: "asc" },
      select: { id: true, slug: true, title: true },
    }),
  ]);
  return (
    <LearningShell>
      <h1 className="text-3xl font-semibold">Выберите формат обучения</h1>
      <Checkout
        plans={plans}
        subjects={subjects.map(({ id, title }) => ({ id, title }))}
        initialPlan={p.plan}
        initialSubject={
          subjects.find((s) => s.id === p.subject || s.slug === p.subject)?.id
        }
        signedIn={!!user}
        email={user?.user.email ?? ""}
        renewal={content.renewal}
        version={content.version}
        offerVersion={legal.offer.version}
        mock={
          getEnv().PAYMENTS_PROVIDER === "mock" || getEnv().YOOKASSA_TEST_MODE
        }
        notice={
          getEnv().PAYMENTS_PROVIDER === "mock"
            ? content.mockNotice
            : content.testShopNotice
        }
      />
    </LearningShell>
  );
}
