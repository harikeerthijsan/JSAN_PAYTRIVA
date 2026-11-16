-- CreateEnum
CREATE TYPE "FinancialRuleKind" AS ENUM ('WITHHOLDING_TAX', 'OTHER_DEDUCTION');

-- CreateEnum
CREATE TYPE "FinancialRuleCalculation" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT');

-- CreateTable
CREATE TABLE "PaymentFinancialRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ruleKind" "FinancialRuleKind" NOT NULL,
    "calculation" "FinancialRuleCalculation" NOT NULL,
    "value" DECIMAL(20,6) NOT NULL,
    "currencyCode" VARCHAR(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentFinancialRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentFinancialRule_name_key" ON "PaymentFinancialRule"("name");

-- CreateIndex
CREATE INDEX "PaymentFinancialRule_isActive_ruleKind_idx" ON "PaymentFinancialRule"("isActive", "ruleKind");

-- AddForeignKey
ALTER TABLE "PaymentFinancialRule" ADD CONSTRAINT "PaymentFinancialRule_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "PaymentCurrency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
