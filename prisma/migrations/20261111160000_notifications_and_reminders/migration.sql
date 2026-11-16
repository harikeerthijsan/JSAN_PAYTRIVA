CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED');

ALTER TABLE "User" ADD COLUMN "timeZone" TEXT NOT NULL DEFAULT 'UTC';

ALTER TABLE "Notification"
  ADD COLUMN "category" TEXT NOT NULL DEFAULT 'general',
  ADD COLUMN "templateKey" TEXT,
  ADD COLUMN "eventKey" TEXT;

CREATE UNIQUE INDEX "Notification_userId_eventKey_key" ON "Notification"("userId", "eventKey");
CREATE INDEX "Notification_userId_category_createdAt_idx" ON "Notification"("userId", "category", "createdAt");

CREATE TABLE "EmailDelivery" (
  "id" TEXT NOT NULL,
  "notificationId" TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  "recipientEmail" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmailDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailDelivery_eventKey_key" ON "EmailDelivery"("eventKey");
CREATE INDEX "EmailDelivery_status_nextAttemptAt_idx" ON "EmailDelivery"("status", "nextAttemptAt");
CREATE INDEX "EmailDelivery_recipientId_createdAt_idx" ON "EmailDelivery"("recipientId", "createdAt");

CREATE TABLE "ReminderSchedule" (
  "id" TEXT NOT NULL,
  "assignmentId" TEXT NOT NULL,
  "nextReminderAt" TIMESTAMP(3),
  "nextStage" INTEGER NOT NULL DEFAULT 1,
  "canceledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReminderSchedule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReminderSchedule_assignmentId_key" ON "ReminderSchedule"("assignmentId");
CREATE INDEX "ReminderSchedule_nextReminderAt_canceledAt_idx" ON "ReminderSchedule"("nextReminderAt", "canceledAt");

CREATE TABLE "NotificationSettings" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
  "enabledCategories" JSONB NOT NULL,
  "reminderHours" JSONB NOT NULL,
  "smtpHost" TEXT,
  "smtpPort" INTEGER NOT NULL DEFAULT 587,
  "smtpSecure" BOOLEAN NOT NULL DEFAULT false,
  "smtpUser" TEXT,
  "smtpPasswordCipher" TEXT,
  "smtpFrom" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedById" TEXT,
  CONSTRAINT "NotificationSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationTemplate" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedById" TEXT,
  CONSTRAINT "NotificationTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationTemplate_key_key" ON "NotificationTemplate"("key");

ALTER TABLE "EmailDelivery"
  ADD CONSTRAINT "EmailDelivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EmailDelivery_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReminderSchedule"
  ADD CONSTRAINT "ReminderSchedule_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "ApprovalAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotificationSettings"
  ADD CONSTRAINT "NotificationSettings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "NotificationTemplate"
  ADD CONSTRAINT "NotificationTemplate_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
