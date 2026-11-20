import { notFound, redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/server";
import { hasCurrentConsent } from "@/lib/auth/legal";
import { normalizeJoinCode } from "@/lib/groups/input";

export default async function JoinInvite({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const code = normalizeJoinCode((await params).code);
  if (!code) notFound();
  const session = await getCurrentSession();
  if (!session || !(await hasCurrentConsent(session.user)))
    redirect(`/login?next=${encodeURIComponent(`/join/${code}`)}`);
  redirect(`/cabinet/groups?code=${code}`);
}
