import { requireUser } from "@/lib/auth/server";
import { paymentStatus } from "@/lib/billing/service";
import { billingConfig } from "@/lib/billing/config";
import { PaymentReturn } from "@/components/billing/return";
import { LearningShell } from "@/components/lessons/shell";
import { notFound } from "next/navigation";
import { ContentError } from "@/lib/content/errors";
export const dynamic = "force-dynamic";
export default async function Return({
  searchParams,
}: {
  searchParams: Promise<{ paymentId?: string }>;
}) {
  const user = await requireUser(),
    id = (await searchParams).paymentId;
  if (!id) notFound();
  let status;
  try {
    status = await paymentStatus(user.id, id, false);
  } catch (e) {
    if (e instanceof ContentError && e.status === 404) notFound();
    throw e;
  }
  return (
    <LearningShell>
      <PaymentReturn
        initial={status}
        timeoutSeconds={(await billingConfig()).pollSeconds}
      />
    </LearningShell>
  );
}
