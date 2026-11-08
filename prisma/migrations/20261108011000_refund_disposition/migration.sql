-- A refund of a stale extra renewal must not revoke a separately purchased period.
ALTER TABLE "PaymentRefund" ADD COLUMN "revokeAccess" BOOLEAN NOT NULL DEFAULT true;
