import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { getEnv } from "@/lib/env";
import { paymentStatus } from "@/lib/billing/service";
import { MockPayment } from "@/components/billing/mock-payment";
import { LearningShell } from "@/components/lessons/shell";
export const dynamic = "force-dynamic";
export default async function MockPay({
  params,
}: {
  params: Promise<{ paymentId: string }>;
}) {
  if (
    getEnv().PAYMENTS_PROVIDER !== "mock" ||
    getEnv().NODE_ENV === "production"
  )
    notFound();
  const user = await requireUser(),
    id = (await params).paymentId,
    p = await paymentStatus(user.id, id, false);
  if (p.status !== "PENDING") redirect(`/checkout/return?paymentId=${id}`);
  return (
    <LearningShell>
      <MockPayment id={id} title={p.title} amount={p.amountKopecks} />
    </LearningShell>
  );
}
