ALTER TABLE "Subscription"
 ADD COLUMN "scopeKey" TEXT,
 ADD COLUMN "periodMonths" INTEGER NOT NULL DEFAULT 1,
 ADD COLUMN "buyerEmail" TEXT,
 ADD COLUMN "renewalConsentedAt" TIMESTAMP(3),
 ADD COLUMN "renewalConsentVersion" TEXT,
 ADD COLUMN "offerVersion" TEXT,
 ADD COLUMN "firstFailedAt" TIMESTAMP(3),
 ADD COLUMN "revokedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Subscription_scopeKey_key" ON "Subscription"("scopeKey");
ALTER TABLE "Payment"
 ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'mock',
 ADD COLUMN "requestKey" TEXT,
 ADD COLUMN "scopeKey" TEXT,
 ADD COLUMN "periodMonths" INTEGER NOT NULL DEFAULT 1,
 ADD COLUMN "planTitle" TEXT NOT NULL DEFAULT '',
 ADD COLUMN "buyerEmail" TEXT,
 ADD COLUMN "renewalConsentedAt" TIMESTAMP(3),
 ADD COLUMN "renewalConsentVersion" TEXT,
 ADD COLUMN "offerVersion" TEXT,
 ADD COLUMN "cycleEnd" TIMESTAMP(3),
 ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "creationStartedAt" TIMESTAMP(3),
 ADD COLUMN "providerRequest" JSONB,
 ADD COLUMN "confirmationUrl" TEXT;
CREATE UNIQUE INDEX "Payment_requestKey_key" ON "Payment"("requestKey");
CREATE TABLE "MockProviderRecord" ("id" TEXT PRIMARY KEY, "data" JSONB NOT NULL);
CREATE TABLE "PaymentRefund" (
 "id" TEXT PRIMARY KEY, "paymentId" TEXT NOT NULL UNIQUE, "providerRefundId" TEXT UNIQUE,
 "status" TEXT NOT NULL DEFAULT 'PENDING', "amountKopecks" INTEGER NOT NULL,
 "requestedById" TEXT, "providerRequest" JSONB, "creationStartedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "finishedAt" TIMESTAMP(3)
);
CREATE TABLE "BillingMail" (
 "key" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "kind" TEXT NOT NULL,
 "referenceId" TEXT NOT NULL, "to" TEXT NOT NULL, "subject" TEXT NOT NULL,
 "text" TEXT NOT NULL, "sentAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
