-- Add AP returns and manually recorded payment processing.
ALTER TYPE "PaymentStatus" ADD VALUE 'RETURNED';
ALTER TYPE "DocumentKind" ADD VALUE 'PAYMENT_PROOF';

CREATE TABLE "PaymentSchedule" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "plannedDate" TIMESTAMP(3),
    "remarks" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PaymentSchedule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentConfirmation" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "amountPaid" DECIMAL(20,6) NOT NULL,
    "currencyCode" VARCHAR(3) NOT NULL,
    "amountPaidUsd" DECIMAL(20,6) NOT NULL,
    "exchangeRate" DECIMAL(24,12) NOT NULL,
    "exchangeRateSource" TEXT NOT NULL,
    "actualPaymentDate" TIMESTAMP(3) NOT NULL,
    "paymentReference" TEXT NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "paymentAccount" TEXT NOT NULL,
    "remarks" TEXT,
    "proofDocumentId" TEXT NOT NULL,
    "processedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PaymentConfirmation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentCorrection" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "confirmationId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "previousValues" JSONB NOT NULL,
    "correctedValues" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentCorrection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentSchedule_requestId_key" ON "PaymentSchedule"("requestId");
CREATE INDEX "PaymentSchedule_plannedDate_idx" ON "PaymentSchedule"("plannedDate");
CREATE UNIQUE INDEX "PaymentConfirmation_requestId_key" ON "PaymentConfirmation"("requestId");
CREATE UNIQUE INDEX "PaymentConfirmation_paymentReference_key" ON "PaymentConfirmation"("paymentReference");
CREATE UNIQUE INDEX "PaymentConfirmation_proofDocumentId_key" ON "PaymentConfirmation"("proofDocumentId");
CREATE INDEX "PaymentConfirmation_actualPaymentDate_idx" ON "PaymentConfirmation"("actualPaymentDate");
CREATE INDEX "PaymentConfirmation_processedById_createdAt_idx" ON "PaymentConfirmation"("processedById", "createdAt");
CREATE INDEX "PaymentCorrection_requestId_createdAt_idx" ON "PaymentCorrection"("requestId", "createdAt");
CREATE INDEX "PaymentCorrection_confirmationId_createdAt_idx" ON "PaymentCorrection"("confirmationId", "createdAt");

ALTER TABLE "PaymentSchedule" ADD CONSTRAINT "PaymentSchedule_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PaymentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentSchedule" ADD CONSTRAINT "PaymentSchedule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentConfirmation" ADD CONSTRAINT "PaymentConfirmation_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PaymentRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentConfirmation" ADD CONSTRAINT "PaymentConfirmation_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "PaymentCurrency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentConfirmation" ADD CONSTRAINT "PaymentConfirmation_proofDocumentId_fkey" FOREIGN KEY ("proofDocumentId") REFERENCES "PaymentDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentConfirmation" ADD CONSTRAINT "PaymentConfirmation_processedById_fkey" FOREIGN KEY ("processedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentCorrection" ADD CONSTRAINT "PaymentCorrection_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PaymentRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentCorrection" ADD CONSTRAINT "PaymentCorrection_confirmationId_fkey" FOREIGN KEY ("confirmationId") REFERENCES "PaymentConfirmation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentCorrection" ADD CONSTRAINT "PaymentCorrection_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
