import { requireAdmin } from "@/lib/auth/server";
import { FacultyManager } from "@/components/admin/org-page";

export default async function OrgPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireAdmin();
  return <FacultyManager admin q={(await searchParams).q} />;
}
