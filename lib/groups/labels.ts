import type { MembershipStatus } from "../generated/prisma/client";

export const membershipLabels: Record<MembershipStatus, string> = {
  PENDING: "Заявка на рассмотрении",
  ACTIVE: "Зачисление подтверждено",
  REJECTED: "Заявка отклонена",
  REMOVED: "Участие прекращено",
};
