import { AuthShell } from "@/components/auth/shell";
import { VerifyForm } from "@/components/auth/verify-form";
import { authRu } from "@/lib/i18n/ru";
import { isToken } from "@/lib/auth/crypto";
export const metadata = {
  referrer: "origin" as const,
  robots: { index: false, follow: false },
};
export default async function Verify({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <AuthShell title={authRu.verifyTitle} description={authRu.verifyText}>
      {isToken(token) ? (
        <VerifyForm token={token} />
      ) : (
        <p role="alert" className="text-sm text-red-800">
          {authRu.errors.invalid}
        </p>
      )}
    </AuthShell>
  );
}
