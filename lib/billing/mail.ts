import { getDb } from "../db";
import type { Prisma } from "../generated/prisma/client";
import { lock } from "../auth/session";
import { createMailTransport } from "../mail";
import { getEnv } from "../env";
import { BILLING_MAIL, enqueueBilling } from "./jobs";
import { billingMailText, mailHtml } from "../../emails/billing";
export async function queueBillingMail(
  tx: Prisma.TransactionClient,
  input: {
    key: string;
    userId: string;
    referenceId: string;
    kind: string;
    email: string | null;
    title: string;
    plan: string;
    amount: number;
    end: Date | null;
    timezone: string;
  },
) {
  if (!input.email) return;
  const row = await tx.billingMail.upsert({
    where: { key: input.key },
    create: {
      key: input.key,
      userId: input.userId,
      referenceId: input.referenceId,
      kind: input.kind,
      to: input.email,
      subject: input.title,
      text: billingMailText(
        input.title,
        input.plan,
        input.amount,
        input.end,
        input.timezone,
      ),
    },
    update: {},
  });
  if (!row.sentAt)
    await enqueueBilling(BILLING_MAIL, { key: row.key }, row.key, tx);
}
export async function deliverBillingMail(key: string) {
  await getDb().$transaction(
    async (tx) => {
      await lock(tx, `billing-mail:${key}`);
      const mail = await tx.billingMail.findUnique({ where: { key } });
      if (!mail || mail.sentAt) return;
      const user = await tx.user.findUnique({
        where: { id: mail.userId },
        select: { deletedAt: true },
      });
      if (!user || user.deletedAt) return;
      await createMailTransport(getEnv()).send({
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        html: mailHtml(mail.text),
      });
      await tx.billingMail.update({
        where: { key },
        data: { sentAt: new Date() },
      });
    },
    { timeout: 15000 },
  );
}
