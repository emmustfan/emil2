import { safePricingReturn } from "../billing/policy";
import { normalizeJoinCode } from "../groups/input";

export function safeLoginReturn(value?: string | null) {
  if (value === "/cabinet/groups") return value;
  const invite = /^\/join\/([a-z0-9]{8})$/i.exec(value ?? "");
  const code = invite && normalizeJoinCode(invite[1]);
  return code ? `/join/${code}` : safePricingReturn(value);
}
