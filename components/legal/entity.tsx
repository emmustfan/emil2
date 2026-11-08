import { getEnv } from "@/lib/env";
export function LegalEntity() {
  const env = getEnv();
  if (!env.LEGAL_ENTITY_NAME && !env.LEGAL_ENTITY_INN && !env.LEGAL_ENTITY_OGRN)
    return null;
  return (
    <p className="mt-4 text-xs leading-6 text-stone-600">
      {env.LEGAL_ENTITY_NAME}
      {env.LEGAL_ENTITY_INN && ` · ИНН ${env.LEGAL_ENTITY_INN}`}
      {env.LEGAL_ENTITY_OGRN && ` · ОГРН/ОГРНИП ${env.LEGAL_ENTITY_OGRN}`}
    </p>
  );
}
