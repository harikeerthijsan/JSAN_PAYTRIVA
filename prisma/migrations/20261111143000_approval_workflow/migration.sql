-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'PENDING_APPROVAL';

-- CreateTable
CREATE TABLE "ApprovalThreshold" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "minUsd" DECIMAL(20,6) NOT NULL,
    "maxUsdExclusive" DECIMAL(20,6),
    "assignedApproverId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApprovalThreshold_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApprovalAssignment" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "thresholdId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    CONSTRAINT "ApprovalAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApprovalComment" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "action" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApprovalComment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClarificationRequest" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    CONSTRAINT "ClarificationRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestId" TEXT,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "href" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ApprovalThreshold_label_key" ON "ApprovalThreshold"("label");
CREATE INDEX "ApprovalThreshold_isActive_minUsd_maxUsdExclusive_idx" ON "ApprovalThreshold"("isActive", "minUsd", "maxUsdExclusive");
CREATE INDEX "ApprovalAssignment_approverId_resolvedAt_assignedAt_idx" ON "ApprovalAssignment"("approverId", "resolvedAt", "assignedAt");
CREATE INDEX "ApprovalAssignment_requestId_assignedAt_idx" ON "ApprovalAssignment"("requestId", "assignedAt");
CREATE INDEX "ApprovalComment_requestId_createdAt_idx" ON "ApprovalComment"("requestId", "createdAt");
CREATE INDEX "ClarificationRequest_requestId_resolvedAt_createdAt_idx" ON "ClarificationRequest"("requestId", "resolvedAt", "createdAt");
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

ALTER TABLE "ApprovalThreshold" ADD CONSTRAINT "ApprovalThreshold_assignedApproverId_fkey" FOREIGN KEY ("assignedApproverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ApprovalAssignment" ADD CONSTRAINT "ApprovalAssignment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PaymentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApprovalAssignment" ADD CONSTRAINT "ApprovalAssignment_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApprovalAssignment" ADD CONSTRAINT "ApprovalAssignment_thresholdId_fkey" FOREIGN KEY ("thresholdId") REFERENCES "ApprovalThreshold"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApprovalComment" ADD CONSTRAINT "ApprovalComment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PaymentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApprovalComment" ADD CONSTRAINT "ApprovalComment_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApprovalComment" ADD CONSTRAINT "ApprovalComment_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "ApprovalAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ClarificationRequest" ADD CONSTRAINT "ClarificationRequest_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PaymentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClarificationRequest" ADD CONSTRAINT "ClarificationRequest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClarificationRequest" ADD CONSTRAINT "ClarificationRequest_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PaymentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "ApprovalThreshold" ("id", "label", "minUsd", "maxUsdExclusive") VALUES
    ('threshold-under-5000', 'Below $5,000', 0, 5000),
    ('threshold-5000-40000', '$5,000 - $39,999.99', 5000, 40000),
    ('threshold-40000-50000', '$40,000 - $49,999.99 (business confirmation required)', 40000, 50000),
    ('threshold-50000-plus', '$50,000 and above', 50000, NULL);
