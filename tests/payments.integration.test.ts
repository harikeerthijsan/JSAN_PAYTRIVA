import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { unlink } from "node:fs/promises";
import { after, test } from "node:test";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createOpaqueToken, hashToken } from "../src/lib/security";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL must be configured for payment integration tests.");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const baseUrl = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3000";
const suffix = randomBytes(5).toString("hex");
const testCurrencyCode = `T${[...randomBytes(2)].map((value) => String.fromCharCode(65 + value % 26)).join("")}`;
const userIds: string[] = [];
const requestIds: string[] = [];
const uploadKeys: string[] = [];
const thresholdAssignments: { id: string; assignedApproverId: string | null }[] = [];

after(async () => {
  for (const threshold of thresholdAssignments) {
    await db.approvalThreshold.update({
      where: { id: threshold.id },
      data: { assignedApproverId: threshold.assignedApproverId },
    });
  }
  for (const id of requestIds) {
    const docs = await db.paymentDocument.findMany({ where: { requestId: id }, select: { storageKey: true } });
    uploadKeys.push(...docs.map(({ storageKey }) => storageKey));
  }
  if (requestIds.length) {
    await db.paymentCorrection.deleteMany({ where: { requestId: { in: requestIds } } });
    await db.paymentConfirmation.deleteMany({ where: { requestId: { in: requestIds } } });
    await db.paymentRequest.deleteMany({ where: { id: { in: requestIds } } });
  }
  if (userIds.length) {
    await db.authSession.deleteMany({ where: { userId: { in: userIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
  }
  const directory = process.env.PAYTRIVA_UPLOAD_DIR ?? ".private-uploads";
  for (const key of uploadKeys) {
    try { await unlink(`${directory}\\${key}`); } catch { /* Test cleanup only. */ }
  }
  await db.paymentProject.deleteMany({ where: { code: `P2-${suffix}` } });
  await db.paymentFinancialRule.deleteMany({ where: { name: `Test withholding ${suffix}` } });
  await db.costCenter.deleteMany({ where: { code: `C2-${suffix}` } });
  await db.paymentEntity.deleteMany({ where: { code: `E2-${suffix}` } });
  await db.currencyExchangeRate.deleteMany({ where: { currencyCode: testCurrencyCode } });
  await db.paymentCurrency.deleteMany({ where: { code: testCurrencyCode } });
  await db.$disconnect();
});

async function createUser(roleKey: string, permissionKeys: string[] = []) {
  const role = await db.role.findUniqueOrThrow({ where: { key: roleKey } });
  const user = await db.user.create({
    data: {
      fullName: `Phase Two ${roleKey} ${suffix}`,
      email: `phase2-${roleKey.toLowerCase()}-${suffix}-${userIds.length}@example.test`,
      activatedAt: new Date(),
      isActive: true,
    },
  });
  userIds.push(user.id);
  await db.userRole.create({ data: { userId: user.id, roleId: role.id } });
  if (permissionKeys.length) {
    const permissions = await db.permission.findMany({ where: { key: { in: permissionKeys } } });
    await db.userPermission.createMany({ data: permissions.map(({ id }) => ({ userId: user.id, permissionId: id })) });
  }
  const token = createOpaqueToken();
  await db.authSession.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 60 * 60 * 1000) } });
  return { user, cookie: `paytriva_session=${token}` };
}

async function api(path: string, cookie: string, init?: RequestInit) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Cookie: cookie,
      ...(init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
    },
  });
}

async function notificationCategoryEnabled(category: string) {
  const settings = await db.notificationSettings.findUnique({
    where: { id: "default" },
    select: { enabledCategories: true },
  });
  if (!settings || typeof settings.enabledCategories !== "object" || settings.enabledCategories === null || Array.isArray(settings.enabledCategories)) return true;
  return (settings.enabledCategories as Record<string, unknown>)[category] !== false;
}

test("payment requests persist drafts, securely submit documents, isolate users, and prevent duplicates", async () => {
  const requestor = await createUser("REQUESTOR");
  const secondRequestor = await createUser("REQUESTOR");
  const ap = await createUser("ACCOUNTS_PAYABLE");
  const paymentAdmin = await createUser("ACCOUNTS_PAYABLE", ["payments:correct", "payments:read_payment_account", "payments:read_payment_proof"]);
  const masterAdmin = await createUser("ACCOUNTS_PAYABLE", ["payments:manage_masters"]);
  const approver = await createUser("APPROVER");
  const code = testCurrencyCode;
  const invoiceDate = new Date(Date.now() - 2 * 86_400_000);
  const dateValue = invoiceDate.toISOString().slice(0, 10);
  const entity = await db.paymentEntity.create({ data: { name: `Phase Two Entity ${suffix}`, code: `E2-${suffix}` } });
  const currency = await db.paymentCurrency.create({ data: { code, name: `Phase Two Currency ${suffix}`, symbol: "¤", decimalPlaces: 2 } });
  const costCenter = await db.costCenter.create({ data: { name: `Phase Two Center ${suffix}`, code: `C2-${suffix}` } });
  const project = await db.paymentProject.create({ data: { name: `Phase Two Project ${suffix}`, code: `P2-${suffix}` } });
  await db.currencyExchangeRate.create({
    data: { currencyCode: currency.code, usdPerUnit: "1.25", source: "Phase 2 integration test", effectiveAt: new Date(`${dateValue}T00:00:00.000Z`) },
  });

  assert.equal((await api("/api/payment-masters", requestor.cookie)).status, 200);
  assert.equal((await api("/api/payment-masters", masterAdmin.cookie).then((response) => response.json())).canManage, true);
  assert.equal((await api("/api/payment-masters", approver.cookie)).status, 403);
  assert.equal((await api("/api/approval-matrix", ap.cookie)).status, 403);
  assert.equal((await api("/api/approvals", requestor.cookie)).status, 403);
  assert.equal((await api("/api/ap/reviews", requestor.cookie)).status, 403);
  assert.equal((await api("/api/payment-masters", ap.cookie, { method: "POST", body: JSON.stringify({ type: "project", name: "Unauthorized" }) })).status, 403);
  for (const endpoint of ["/api/ap/management", "/api/ap/payments", "/api/ap/calendar", "/api/ap/projects"]) {
    assert.equal((await api(endpoint, requestor.cookie)).status, 403);
    assert.equal((await api(endpoint, ap.cookie)).status, 200);
  }
  const ruleResponse = await api("/api/payment-masters", masterAdmin.cookie, {
    method: "POST",
    body: JSON.stringify({
      type: "financialRule",
      name: `Test withholding ${suffix}`,
      ruleKind: "WITHHOLDING_TAX",
      calculation: "PERCENTAGE",
      value: "2.5",
    }),
  });
  assert.equal(ruleResponse.status, 201);
  const rule = await ruleResponse.json();
  assert.equal(rule.value, "2.5");
  assert.equal((await api("/api/payment-masters", masterAdmin.cookie, {
    method: "PATCH",
    body: JSON.stringify({ type: "financialRule", id: rule.id, isActive: false }),
  })).status, 200);
  assert.equal((await fetch(`${baseUrl}/api/payment-requests`)).status, 401);

  const form = {
    vendorName: `Vendor ${suffix}`,
    description: "Consulting service",
    billToEntityId: entity.id,
    billFrom: "Consulting division",
    invoiceNumber: `INV-${suffix}`,
    invoiceDate: dateValue,
    serviceStartDate: "",
    serviceEndDate: "",
    currencyCode: currency.code,
    invoiceAmount: "100.25",
    taxAmount: "5",
    dueDate: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
    costCenterId: costCenter.id,
    projectId: project.id,
  };
  const draftResponse = await api("/api/payment-requests", requestor.cookie, {
    method: "POST",
    body: JSON.stringify({ ...form, action: "draft" }),
  });
  assert.equal(draftResponse.status, 201);
  const draft = await draftResponse.json();
  requestIds.push(draft.id);
  assert.equal(draft.status, "DRAFT");
  assert.match(draft.transactionId, /^PTR-\d{8}-[A-F0-9]{10}$/);

  const isolated = await api("/api/payment-requests", secondRequestor.cookie);
  assert.equal((await isolated.json()).total, 0);
  const listOwn = await api("/api/payment-requests", requestor.cookie);
  assert.equal((await listOwn.json()).total, 1);
  const hiddenDrafts = await api("/api/payment-requests?status=DRAFT", ap.cookie);
  assert.equal((await hiddenDrafts.json()).total, 0);
  const invalidDate = await api(`/api/payment-requests/${draft.id}`, requestor.cookie, {
    method: "PATCH",
    body: JSON.stringify({ ...form, action: "draft", invoiceDate: "2025-02-31" }),
  });
  assert.equal(invalidDate.status, 400);

  const upload = new FormData();
  upload.set("kind", "INVOICE");
  upload.set("file", new Blob(["%PDF-1.7\nphase two integration invoice"], { type: "application/pdf" }), "invoice.pdf");
  const uploadedResponse = await api(`/api/payment-requests/${draft.id}/documents`, requestor.cookie, { method: "POST", body: upload });
  assert.equal(uploadedResponse.status, 201);
  const uploaded = await uploadedResponse.json();
  const forbiddenFile = await api(`/api/payment-documents/${uploaded.id}`, secondRequestor.cookie);
  assert.equal(forbiddenFile.status, 404);
  assert.equal((await api(`/api/payment-documents/${uploaded.id}?preview=1`, requestor.cookie)).headers.get("content-disposition")?.startsWith("inline"), true);

  const submitResponse = await api(`/api/payment-requests/${draft.id}`, requestor.cookie, {
    method: "PATCH",
    body: JSON.stringify({ ...form, action: "submit", invoiceDocumentId: uploaded.id, attachmentIds: [] }),
  });
  assert.equal(submitResponse.status, 200);
  assert.equal((await submitResponse.json()).status, "PENDING_REVIEW");
  const detailResponse = await api(`/api/payment-requests/${draft.id}`, requestor.cookie);
  const detail = await detailResponse.json();
  assert.equal(detail.totalPayable, "105.25");
  assert.equal(detail.finalValueUsd, "131.5625");
  assert.equal(detail.history.length, 2);
  const scopedNotification = await db.notification.create({
    data: {
      userId: requestor.user.id,
      requestId: draft.id,
      eventKey: `integration:${suffix}:scoped-notification`,
      category: "request_submitted",
      title: "Integration notification",
      message: "Scoped notification test.",
      href: `/payment-requests/${draft.id}`,
    },
  });
  const requestorNotifications = await api("/api/notifications?type=request_submitted", requestor.cookie).then((response) => response.json());
  const otherUserNotifications = await api("/api/notifications?type=request_submitted", secondRequestor.cookie).then((response) => response.json());
  assert.equal(requestorNotifications.items.some((item: { id: string }) => item.id === scopedNotification.id), true);
  assert.equal(otherUserNotifications.items.some((item: { id: string }) => item.id === scopedNotification.id), false);
  assert.equal((await api("/api/notifications", secondRequestor.cookie, {
    method: "PATCH",
    body: JSON.stringify({ id: scopedNotification.id }),
  })).status, 200);
  assert.equal((await db.notification.findUniqueOrThrow({ where: { id: scopedNotification.id } })).readAt, null);
  assert.equal((await api("/api/notifications", requestor.cookie, {
    method: "PATCH",
    body: JSON.stringify({ id: scopedNotification.id }),
  })).status, 200);
  assert.ok((await db.notification.findUniqueOrThrow({ where: { id: scopedNotification.id } })).readAt);
  assert.equal((await api("/api/payment-requests", ap.cookie).then((response) => response.json())).total, 1);
  assert.equal((await api(`/api/payment-documents/${uploaded.id}`, ap.cookie)).status, 200);

  const duplicateDraftResponse = await api("/api/payment-requests", requestor.cookie, {
    method: "POST",
    body: JSON.stringify({ ...form, action: "draft" }),
  });
  const duplicateDraft = await duplicateDraftResponse.json();
  requestIds.push(duplicateDraft.id);
  const secondUpload = new FormData();
  secondUpload.set("kind", "INVOICE");
  secondUpload.set("file", new Blob(["%PDF-1.7\nduplicate invoice"], { type: "application/pdf" }), "duplicate.pdf");
  const secondUploaded = await api(`/api/payment-requests/${duplicateDraft.id}/documents`, requestor.cookie, { method: "POST", body: secondUpload });
  assert.equal(secondUploaded.status, 201);
  const secondDocument = await secondUploaded.json();
  const duplicateSubmit = await api(`/api/payment-requests/${duplicateDraft.id}`, requestor.cookie, {
    method: "PATCH",
    body: JSON.stringify({ ...form, action: "submit", invoiceDocumentId: secondDocument.id, attachmentIds: [] }),
  });
  assert.equal(duplicateSubmit.status, 409);
  assert.equal((await duplicateSubmit.json()).duplicate.transactionId, draft.transactionId);
  assert.equal((await api(`/api/payment-requests/${duplicateDraft.id}`, secondRequestor.cookie)).status, 404);

  const raceForm = { ...form, vendorName: `Concurrent Vendor ${suffix}`, invoiceNumber: `RACE-${suffix}` };
  const raceDrafts = await Promise.all([0, 1].map(async () => {
    const response = await api("/api/payment-requests", requestor.cookie, {
      method: "POST",
      body: JSON.stringify({ ...raceForm, action: "draft" }),
    });
    assert.equal(response.status, 201);
    const result = await response.json();
    requestIds.push(result.id);
    return result;
  }));
  const raceDocuments = await Promise.all(raceDrafts.map(async (raceDraft, index) => {
    const body = new FormData();
    body.set("kind", "INVOICE");
    body.set("file", new Blob([`%PDF-1.7\nconcurrent ${index}`], { type: "application/pdf" }), `concurrent-${index}.pdf`);
    const response = await api(`/api/payment-requests/${raceDraft.id}/documents`, requestor.cookie, { method: "POST", body });
    assert.equal(response.status, 201);
    return response.json();
  }));
  const concurrentSubmissions = await Promise.all(raceDrafts.map((raceDraft, index) => api(`/api/payment-requests/${raceDraft.id}`, requestor.cookie, {
    method: "PATCH",
    body: JSON.stringify({ ...raceForm, action: "submit", invoiceDocumentId: raceDocuments[index].id, attachmentIds: [] }),
  })));
  assert.deepEqual(concurrentSubmissions.map((response) => response.status).sort(), [200, 409]);

  const secondApprover = await createUser("APPROVER");
  assert.equal((await api("/api/approvals", secondApprover.cookie).then((response) => response.json())).items.length, 0);
  assert.equal((await api(`/api/payment-requests/${draft.id}/workflow`, requestor.cookie, {
    method: "POST",
    body: JSON.stringify({ action: "start_review" }),
  })).status, 403);
  assert.equal((await api(`/api/payment-requests/${draft.id}/workflow`, ap.cookie, {
    method: "POST",
    body: JSON.stringify({ action: "send_approval" }),
  })).status, 409);

  const matrixResponse = await api("/api/approval-matrix", masterAdmin.cookie);
  assert.equal(matrixResponse.status, 200);
  const matrix = await matrixResponse.json();
  const lowBand = matrix.thresholds.find((threshold: { minUsd: string }) => threshold.minUsd === "0");
  const highBand = matrix.thresholds.find((threshold: { minUsd: string }) => threshold.minUsd === "50000");
  assert.ok(lowBand);
  assert.ok(highBand);
  thresholdAssignments.push({ id: lowBand.id, assignedApproverId: lowBand.assignedApproverId });
  thresholdAssignments.push({ id: highBand.id, assignedApproverId: highBand.assignedApproverId });
  const setMatrix = async (lowApproverId: string | null, highApproverId: string | null) => api("/api/approval-matrix", masterAdmin.cookie, {
    method: "PATCH",
    body: JSON.stringify({
      assignments: matrix.thresholds.map((threshold: { id: string }) => ({
        thresholdId: threshold.id,
        approverId: threshold.id === lowBand.id
          ? lowApproverId
          : threshold.id === highBand.id
            ? highApproverId
            : matrix.thresholds.find((item: { id: string }) => item.id === threshold.id).assignedApproverId,
      })),
    }),
  });
  assert.equal((await setMatrix(null, approver.user.id)).status, 200);
  assert.equal((await api(`/api/payment-requests/${draft.id}/workflow`, ap.cookie, {
    method: "POST",
    body: JSON.stringify({ action: "start_review" }),
  })).status, 200);
  const missingBand = await api(`/api/payment-requests/${draft.id}/workflow`, ap.cookie, {
    method: "POST",
    body: JSON.stringify({ action: "send_approval" }),
  });
  assert.equal(missingBand.status, 409);
  assert.match((await missingBand.json()).error, /no approver is assigned/i);
  assert.equal((await setMatrix(approver.user.id, approver.user.id)).status, 200);
  assert.equal((await api(`/api/payment-requests/${draft.id}/workflow`, ap.cookie, {
    method: "POST",
    body: JSON.stringify({ action: "send_approval" }),
  })).status, 200);
  const approvalAssignment = await db.approvalAssignment.findFirstOrThrow({
    where: { requestId: draft.id, approverId: approver.user.id, resolvedAt: null },
  });
  const reminderSchedule = await db.reminderSchedule.findUniqueOrThrow({ where: { assignmentId: approvalAssignment.id } });
  assert.ok(reminderSchedule.nextReminderAt);
  assert.ok(reminderSchedule.nextReminderAt.getTime() >= Date.now() + 7 * 60 * 60 * 1000);
  assert.ok(reminderSchedule.nextReminderAt.getTime() <= Date.now() + 9 * 60 * 60 * 1000);
  const assignedNotifications = await db.notification.findMany({
    where: { requestId: draft.id, userId: approver.user.id, category: "approval_request" },
  });
  if (await notificationCategoryEnabled("approval_request")) {
    assert.equal(assignedNotifications.some((item) => item.title === "New approval request"), true);
    assert.equal((await api("/api/notifications", requestor.cookie).then((response) => response.json())).items.some((item: { title: string }) => item.title === "Sent for Approval"), true);
  }
  assert.equal((await api(`/api/payment-requests/${draft.id}/workflow`, secondApprover.cookie, {
    method: "POST",
    body: JSON.stringify({ action: "approve" }),
  })).status, 403);
  const approvalDetail = await api(`/api/payment-requests/${draft.id}`, approver.cookie);
  assert.equal(approvalDetail.status, 200);
  assert.equal((await api(`/api/payment-documents/${uploaded.id}`, approver.cookie)).status, 200);
  assert.equal((await api(`/api/payment-requests/${draft.id}`, secondRequestor.cookie)).status, 404);
  const duplicateDecisions = await Promise.all([0, 1].map(() => api(`/api/payment-requests/${draft.id}/workflow`, approver.cookie, {
    method: "POST",
    body: JSON.stringify({ action: "approve", comment: "Validated." }),
  })));
  assert.deepEqual(duplicateDecisions.map((response) => response.status).sort(), [200, 409]);
  assert.ok((await db.reminderSchedule.findUniqueOrThrow({ where: { assignmentId: approvalAssignment.id } })).canceledAt);
  assert.equal((await api("/api/ap/reviews", ap.cookie).then((response) => response.json())).readyCount >= 1, true);

  const paymentQueue = await api("/api/ap/payments", ap.cookie);
  assert.equal(paymentQueue.status, 200);
  assert.equal((await paymentQueue.json()).items.some((item: { id: string }) => item.id === draft.id), true);
  const csvExport = await api("/api/ap/payments?export=csv", ap.cookie);
  assert.equal(csvExport.headers.get("content-type")?.includes("text/csv"), true);
  assert.match(await csvExport.text(), /"Transaction ID","Vendor","Invoice Number"/);
  // Respect the Phase 6 seven-day minimum: schedule to the first eligible Wednesday
  // on or after submission date + 7 calendar days.
  const earliestEligible = new Date();
  earliestEligible.setUTCHours(0, 0, 0, 0);
  earliestEligible.setUTCDate(earliestEligible.getUTCDate() + 7);
  const nextWednesday = new Date(earliestEligible);
  nextWednesday.setUTCDate(earliestEligible.getUTCDate() + ((3 - earliestEligible.getUTCDay() + 7) % 7));
  const plannedDate = nextWednesday.toISOString().slice(0, 10);
  const scheduleResponse = await api(`/api/ap/payments/${draft.id}/schedule`, ap.cookie, {
    method: "PATCH",
    body: JSON.stringify({ plannedDate }),
  });
  assert.equal(scheduleResponse.status, 200);
  const calendar = await api("/api/ap/calendar", ap.cookie).then((response) => response.json());
  assert.equal(calendar.items.find((item: { id: string }) => item.id === draft.id)?.isWednesday, true);
  const projectSummary = await api(`/api/ap/projects?projectId=${project.id}`, ap.cookie).then((response) => response.json());
  assert.equal(projectSummary.items[0]?.projectName, project.name);

  const paymentForm = new FormData();
  paymentForm.set("amountPaid", "105.25");
  paymentForm.set("currencyCode", currency.code);
  paymentForm.set("actualPaymentDate", new Date().toISOString().slice(0, 10));
  paymentForm.set("paymentReference", `PAY-${suffix}`);
  paymentForm.set("paymentMethod", "Bank transfer");
  paymentForm.set("paymentAccount", "Account-12345");
  paymentForm.set("remarks", "Confirmed outside PAYTRIVA.");
  paymentForm.set("proof", new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: "image/png" }), "proof.png");
  const confirmationResponse = await api(`/api/ap/payments/${draft.id}/confirm`, ap.cookie, { method: "POST", body: paymentForm });
  assert.equal(confirmationResponse.status, 201, await confirmationResponse.clone().text());
  const confirmation = await confirmationResponse.json();
  assert.equal(confirmation.confirmation.currencyCode, currency.code);
  assert.equal((await api(`/api/ap/payments/${draft.id}/confirm`, ap.cookie, { method: "POST", body: paymentForm })).status, 409);
  assert.equal((await api(`/api/payment-documents/${confirmation.document.id}`, requestor.cookie)).status, 404);
  assert.equal((await api(`/api/payment-documents/${confirmation.document.id}`, ap.cookie)).status, 200);
  const restrictedDetail = await api(`/api/payment-requests/${draft.id}`, ap.cookie).then((response) => response.json());
  assert.equal(restrictedDetail.paymentConfirmation.paymentAccount, "Restricted");
  const forbiddenCorrection = await api(`/api/ap/payments/${draft.id}/corrections`, ap.cookie, {
    method: "POST",
    body: JSON.stringify({
      reason: "Correct payment reference.",
      amountPaid: "105.25",
      currencyCode: currency.code,
      actualPaymentDate: new Date().toISOString().slice(0, 10),
      paymentReference: `PAY-CORR-${suffix}`,
      paymentMethod: "Bank transfer",
      paymentAccount: "Account-12345",
    }),
  });
  assert.equal(forbiddenCorrection.status, 403);
  const correctionResponse = await api(`/api/ap/payments/${draft.id}/corrections`, paymentAdmin.cookie, {
    method: "POST",
    body: JSON.stringify({
      reason: "Corrected the payment reference.",
      amountPaid: "105.25",
      currencyCode: currency.code,
      actualPaymentDate: new Date().toISOString().slice(0, 10),
      paymentReference: `PAY-CORR-${suffix}`,
      paymentMethod: "Bank transfer",
      paymentAccount: "Account-12345-corrected",
      remarks: "Corrected reference after bank reconciliation.",
    }),
  });
  assert.equal(correctionResponse.status, 200);
  const requestorPaymentDetails = await api(`/api/payment-requests/${draft.id}`, requestor.cookie).then((response) => response.json());
  assert.equal(requestorPaymentDetails.paymentConfirmation.paymentAccount, "Restricted");
  assert.equal(requestorPaymentDetails.paymentConfirmation.corrections[0].previousValues.paymentAccount, "Restricted");
  const administratorPaymentDetails = await api(`/api/payment-requests/${draft.id}`, paymentAdmin.cookie).then((response) => response.json());
  assert.equal(administratorPaymentDetails.paymentConfirmation.paymentAccount, "Account-12345-corrected");
  assert.equal(administratorPaymentDetails.paymentConfirmation.corrections[0].previousValues.paymentAccount, "Account-12345");
  assert.equal((await api("/api/ap/projects", ap.cookie).then((response) => response.json())).items[0].totalPaidUsd, "131.56");

  const resubmitForm = { ...form, vendorName: `Clarification Vendor ${suffix}`, invoiceNumber: `CLAR-${suffix}` };
  const clarifySubmit = await api(`/api/payment-requests/${duplicateDraft.id}`, requestor.cookie, {
    method: "PATCH",
    body: JSON.stringify({ ...resubmitForm, action: "submit", invoiceDocumentId: secondDocument.id, attachmentIds: [] }),
  });
  assert.equal(clarifySubmit.status, 200);
  assert.equal((await api(`/api/payment-requests/${duplicateDraft.id}/workflow`, ap.cookie, {
    method: "POST",
    body: JSON.stringify({ action: "return" }),
  })).status, 400);
  assert.equal((await api(`/api/payment-requests/${duplicateDraft.id}/workflow`, ap.cookie, {
    method: "POST",
    body: JSON.stringify({ action: "clarification", comment: "Please attach the corrected invoice details." }),
  })).status, 200);
  const firstResubmission = await api(`/api/payment-requests/${duplicateDraft.id}`, requestor.cookie, {
    method: "PATCH",
    body: JSON.stringify({ ...resubmitForm, action: "submit", invoiceDocumentId: secondDocument.id, attachmentIds: [] }),
  });
  assert.equal(firstResubmission.status, 200, await firstResubmission.clone().text());
  assert.equal((await api(`/api/payment-requests/${duplicateDraft.id}/workflow`, ap.cookie, {
    method: "POST",
    body: JSON.stringify({ action: "start_review" }),
  })).status, 200);
  assert.equal((await api(`/api/payment-requests/${duplicateDraft.id}/workflow`, ap.cookie, {
    method: "POST",
    body: JSON.stringify({ action: "send_approval" }),
  })).status, 200);
  assert.equal((await api(`/api/payment-requests/${duplicateDraft.id}/workflow`, approver.cookie, {
    method: "POST",
    body: JSON.stringify({ action: "request_clarification", comment: "Please correct the invoice number." }),
  })).status, 200);
  assert.equal((await api("/api/notifications", requestor.cookie).then((response) => response.json())).unread > 0, true);
  const updatedForm = { ...resubmitForm, invoiceNumber: `CLAR-UPDATED-${suffix}`, invoiceAmount: "40000" };
  const resubmission = await api(`/api/payment-requests/${duplicateDraft.id}`, requestor.cookie, {
    method: "PATCH",
    body: JSON.stringify({ ...updatedForm, action: "submit", invoiceDocumentId: secondDocument.id, attachmentIds: [] }),
  });
  assert.equal(resubmission.status, 200);
  assert.equal((await resubmission.json()).status, "PENDING_REVIEW");
  const resubmittedDetail = await api(`/api/payment-requests/${duplicateDraft.id}`, requestor.cookie).then((response) => response.json());
  assert.equal(resubmittedDetail.finalValueUsd, "50006.25");
  assert.equal(resubmittedDetail.history.filter((entry: { action: string }) => entry.action === "RESUBMITTED").length, 2);
  assert.equal((await api(`/api/payment-requests/${duplicateDraft.id}/workflow`, ap.cookie, {
    method: "POST",
    body: JSON.stringify({ action: "start_review" }),
  })).status, 200);
  assert.equal((await api(`/api/payment-requests/${duplicateDraft.id}/workflow`, ap.cookie, {
    method: "POST",
    body: JSON.stringify({ action: "send_approval" }),
  })).status, 200);
  assert.equal((await api(`/api/payment-requests/${duplicateDraft.id}/workflow`, approver.cookie, {
    method: "POST",
    body: JSON.stringify({ action: "reject" }),
  })).status, 400);
  assert.equal((await api(`/api/payment-requests/${duplicateDraft.id}/workflow`, approver.cookie, {
    method: "POST",
    body: JSON.stringify({ action: "reject", comment: "Invoice data remains incomplete." }),
  })).status, 200);
  const rejectedDetail = await api(`/api/payment-requests/${duplicateDraft.id}`, requestor.cookie).then((response) => response.json());
  assert.equal(rejectedDetail.status, "REJECTED");
  assert.equal(rejectedDetail.approvalAssignments.length, 2);
  assert.equal(rejectedDetail.approvalAssignments[0].threshold.label, lowBand.label);
  assert.equal(rejectedDetail.approvalAssignments[1].threshold.label, highBand.label);
  assert.deepEqual(rejectedDetail.clarificationRequests.map((entry: { reason: string }) => entry.reason), [
    "Please attach the corrected invoice details.",
    "Please correct the invoice number.",
  ]);
});
