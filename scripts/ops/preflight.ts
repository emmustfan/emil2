import { getEnv } from "../../lib/env";
const env = getEnv();
if (env.NODE_ENV !== "production")
  throw new Error("Production image requires NODE_ENV=production");
if (!env.TRUST_PROXY)
  throw new Error("Production gateway requires TRUST_PROXY=true");
if (!env.LEGAL_ENTITY_NAME || !env.LEGAL_ENTITY_INN || !env.SUPPORT_EMAIL)
  throw new Error("Set legal entity and support contacts before public launch");
console.log("production_configuration_valid");
