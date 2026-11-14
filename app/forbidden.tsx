import { AuthShell } from "@/components/auth/shell";
import { authRu } from "@/lib/i18n/ru";
export default function Forbidden() {
  return (
    <AuthShell title={authRu.forbidden}>
      <a href="/cabinet" className="underline">
        {authRu.cabinet}
      </a>
    </AuthShell>
  );
}
