-- CreateEnum
CREATE TYPE "PaymentRiskStatus" AS ENUM ('ON_TRACK', 'AT_RISK');

-- AlterTable
ALTER TABLE "ApprovalThreshold" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PaymentSchedule" ADD COLUMN     "autoScheduled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "earliestEligibleDate" TIMESTAMP(3),
ADD COLUMN     "riskStatus" "PaymentRiskStatus" NOT NULL DEFAULT 'ON_TRACK';

-- CreateTable
CREATE TABLE "PaymentScheduleHistory" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "scheduledDate" TIMESTAMP(3),
    "earliestEligibleDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "riskStatus" "PaymentRiskStatus",
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentScheduleHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentScheduleHistory_requestId_createdAt_idx" ON "PaymentScheduleHistory"("requestId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentSchedule_riskStatus_plannedDate_idx" ON "PaymentSchedule"("riskStatus", "plannedDate");

-- AddForeignKey
ALTER TABLE "PaymentScheduleHistory" ADD CONSTRAINT "PaymentScheduleHistory_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PaymentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentScheduleHistory" ADD CONSTRAINT "PaymentScheduleHistory_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
