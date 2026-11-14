import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/server";
import { currentDemo } from "@/lib/demo/request";
import { demoView } from "@/lib/demo/service";
import { DemoFunnel } from "@/components/demo/funnel";
import { LearningShell } from "@/components/lessons/shell";
import { getEnv } from "@/lib/env";
import { ContentError } from "@/lib/content/errors";
import Link from "next/link";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Попробуйте обучение бесплатно",
  robots: { index: false, follow: false },
};
export default async function Demo({
  searchParams,
}: {
  searchParams: Promise<{ source?: string }>;
}) {
  if (await getCurrentSession()) redirect("/cabinet");
  const demo = await currentDemo();
  let view;
  try {
    view = await demoView(
      demo.id,
      (await searchParams).source === "landing" ? "landing" : "direct",
    );
  } catch (error) {
    if (!(error instanceof ContentError)) throw error;
    return (
      <LearningShell>
        <h1 className="text-3xl font-semibold">Материалы демо обновлены</h1>
        <p className="my-6">{error.message}</p>
        <Link href="/subjects" className="lesson-primary">
          К бесплатным темам
        </Link>
      </LearningShell>
    );
  }
  return (
    <LearningShell>
      <DemoFunnel initial={view} tutorMock={getEnv().LLM_PROVIDER === "mock"} />
    </LearningShell>
  );
}
