-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'UNDER_REVIEW', 'NEEDS_INFORMATION', 'APPROVED', 'REJECTED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('INVOICE', 'ATTACHMENT');

-- CreateTable
CREATE TABLE "PaymentRequest" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "requestorId" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'DRAFT',
    "vendorName" TEXT,
    "description" TEXT,
    "billToEntityId" TEXT,
    "billFrom" TEXT,
    "invoiceNumber" TEXT,
    "invoiceDate" TIMESTAMP(3),
    "serviceStartDate" TIMESTAMP(3),
    "serviceEndDate" TIMESTAMP(3),
    "currencyCode" TEXT,
    "invoiceAmount" DECIMAL(20,6),
    "invoiceAmountUsd" DECIMAL(20,6),
    "taxAmount" DECIMAL(20,6),
    "totalPayable" DECIMAL(20,6),
    "finalValueUsd" DECIMAL(20,6),
    "exchangeRate" DECIMAL(24,12),
    "exchangeRateSource" TEXT,
    "conversionDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "costCenterId" TEXT,
    "projectId" TEXT,
    "duplicateKey" TEXT,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentDocument" (
    "id" TEXT NOT NULL,
    "requestId" TEXT,
    "ownerId" TEXT NOT NULL,
    "kind" "DocumentKind" NOT NULL,
    "filename" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRequestHistory" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "fromStatus" "PaymentStatus",
    "toStatus" "PaymentStatus",
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentRequestHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentCurrency" (
    "code" VARCHAR(3) NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "decimalPlaces" INTEGER NOT NULL DEFAULT 2,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentCurrency_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "CurrencyExchangeRate" (
    "id" TEXT NOT NULL,
    "currencyCode" VARCHAR(3) NOT NULL,
    "usdPerUnit" DECIMAL(24,12) NOT NULL,
    "source" TEXT NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CurrencyExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentEntity" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostCenter" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostCenter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentProject" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentProject_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRequest_transactionId_key" ON "PaymentRequest"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRequest_duplicateKey_key" ON "PaymentRequest"("duplicateKey");

-- CreateIndex
CREATE INDEX "PaymentRequest_requestorId_status_updatedAt_idx" ON "PaymentRequest"("requestorId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "PaymentRequest_status_submittedAt_idx" ON "PaymentRequest"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "PaymentRequest_projectId_status_idx" ON "PaymentRequest"("projectId", "status");

-- CreateIndex
CREATE INDEX "PaymentRequest_vendorName_invoiceNumber_idx" ON "PaymentRequest"("vendorName", "invoiceNumber");

-- CreateIndex
CREATE INDEX "PaymentRequest_dueDate_idx" ON "PaymentRequest"("dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentDocument_storageKey_key" ON "PaymentDocument"("storageKey");

-- CreateIndex
CREATE INDEX "PaymentDocument_requestId_kind_idx" ON "PaymentDocument"("requestId", "kind");

-- CreateIndex
CREATE INDEX "PaymentDocument_ownerId_createdAt_idx" ON "PaymentDocument"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentRequestHistory_requestId_createdAt_idx" ON "PaymentRequestHistory"("requestId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentCurrency_isActive_name_idx" ON "PaymentCurrency"("isActive", "name");

-- CreateIndex
CREATE INDEX "CurrencyExchangeRate_currencyCode_effectiveAt_idx" ON "CurrencyExchangeRate"("currencyCode", "effectiveAt");

-- CreateIndex
CREATE UNIQUE INDEX "CurrencyExchangeRate_currencyCode_source_effectiveAt_key" ON "CurrencyExchangeRate"("currencyCode", "source", "effectiveAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentEntity_name_key" ON "PaymentEntity"("name");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentEntity_code_key" ON "PaymentEntity"("code");

-- CreateIndex
CREATE INDEX "PaymentEntity_isActive_name_idx" ON "PaymentEntity"("isActive", "name");

-- CreateIndex
CREATE UNIQUE INDEX "CostCenter_code_key" ON "CostCenter"("code");

-- CreateIndex
CREATE INDEX "CostCenter_isActive_name_idx" ON "CostCenter"("isActive", "name");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentProject_code_key" ON "PaymentProject"("code");

-- CreateIndex
CREATE INDEX "PaymentProject_isActive_name_idx" ON "PaymentProject"("isActive", "name");

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_requestorId_fkey" FOREIGN KEY ("requestorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_billToEntityId_fkey" FOREIGN KEY ("billToEntityId") REFERENCES "PaymentEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "PaymentCurrency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "PaymentProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentDocument" ADD CONSTRAINT "PaymentDocument_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PaymentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentDocument" ADD CONSTRAINT "PaymentDocument_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequestHistory" ADD CONSTRAINT "PaymentRequestHistory_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PaymentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequestHistory" ADD CONSTRAINT "PaymentRequestHistory_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurrencyExchangeRate" ADD CONSTRAINT "CurrencyExchangeRate_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "PaymentCurrency"("code") ON DELETE CASCADE ON UPDATE CASCADE;
