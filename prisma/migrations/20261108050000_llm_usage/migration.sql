CREATE TABLE "LlmUsage" (
 "id" TEXT NOT NULL,
 "kind" TEXT NOT NULL,
 "model" TEXT NOT NULL,
 "tokensIn" INTEGER,
 "tokensOut" INTEGER,
 "estimatedCostRub" DECIMAL(18,8),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "LlmUsage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LlmUsage_createdAt_idx" ON "LlmUsage"("createdAt");
