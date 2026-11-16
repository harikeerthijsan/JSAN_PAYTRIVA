import "dotenv/config";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { PaymentStatus, PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createOpaqueToken, hashToken } from "../src/lib/security";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL must be configured for management report integration tests.");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const baseUrl = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3000";
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const vendorTag = `MGMT-${suffix}`;
const userIds: string[] = [];
const requestIds: string[] = [];

after(async () => {
  await db.paymentConfirmation.deleteMany({ where: { requestId: { in: requestIds } } });
  if (requestIds.length) await db.paymentRequest.deleteMany({ where: { id: { in: requestIds } } });
  if (userIds.length) {
    await db.authSession.deleteMany({ where: { userId: { in: userIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
  }
  await db.$disconnect();
});

async function createUser(roleKey: string, permissionKeys: string[] = []) {
  const role = await db.role.findUniqueOrThrow({ where: { key: roleKey } });
  const user = await db.user.create({
    data: { fullName: `Mgmt ${roleKey}`, email: `mgmt-${roleKey.toLowerCase()}-${suffix}-${userIds.length}@example.test`, isActive: true, activatedAt: new Date() },
  });
  userIds.push(user.id);
  await db.userRole.create({ data: { userId: user.id, roleId: role.id } });
  for (const key of permissionKeys) {
    const permission = await db.permission.findUniqueOrThrow({ where: { key } });
    await db.userPermission.create({ data: { userId: user.id, permissionId: permission.id } });
  }
  const token = createOpaqueToken();
  await db.authSession.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 3_600_000) } });
  return { user, cookie: `paytriva_session=${token}` };
}

async function api(path: string, cookie: string) {
  return fetch(`${baseUrl}${path}`, { headers: { Cookie: cookie } });
}

const dayAgo = (days: number) => new Date(Date.now() - days * 86_400_000);
const dayAhead = (days: number) => new Date(Date.now() + days * 86_400_000);
const utcDay = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

let manager: { user: { id: string }; cookie: string };
let requestor: { user: { id: string }; cookie: string };

async function seedScenario() {
  manager = await createUser("REQUESTOR", ["reports:access"]);
  requestor = await createUser("REQUESTOR");
  const approver = await createUser("APPROVER");
  const ap = await createUser("ACCOUNTS_PAYABLE");

  async function request(status: PaymentStatus, data: Record<string, unknown>) {
    const created = await db.paymentRequest.create({
      data: {
        transactionId: `PTR-${vendorTag}-${requestIds.length}`,
        requestorId: requestor.user.id,
        status,
        vendorName: vendorTag,
        invoiceNumber: `INV-${suffix}-${requestIds.length}`,
        submittedAt: dayAgo(3),
        ...data,
      },
    });
    requestIds.push(created.id);
    return created;
  }

  // Pending approval (for aging), assigned 30h ago.
  const pending = await request(PaymentStatus.PENDING_APPROVAL, { finalValueUsd: "500.00", invoiceAmount: "500.00", currencyCode: "USD" });
  await db.approvalAssignment.create({ data: { requestId: pending.id, approverId: approver.user.id, thresholdId: (await db.approvalThreshold.findFirstOrThrow({ where: { isActive: true } })).id, assignedAt: dayAgo(1.25) } });

  // Approved + overdue.
  const overdue = await request(PaymentStatus.APPROVED, { finalValueUsd: "1000.00", invoiceAmount: "1000.00", currencyCode: "USD", dueDate: dayAgo(5) });
  await db.paymentSchedule.create({ data: { requestId: overdue.id, plannedDate: utcDay(dayAgo(4)), earliestEligibleDate: utcDay(dayAgo(10)), createdById: requestor.user.id } });

  // Approved + upcoming.
  const upcoming = await request(PaymentStatus.APPROVED, { finalValueUsd: "2000.00", invoiceAmount: "2000.00", currencyCode: "USD", dueDate: dayAhead(30) });
  await db.paymentSchedule.create({ data: { requestId: upcoming.id, plannedDate: utcDay(dayAhead(5)), earliestEligibleDate: utcDay(dayAhead(2)), createdById: requestor.user.id } });

  // Paid (confirmed) for Total Paid.
  const paid = await request(PaymentStatus.PAID, { finalValueUsd: "900.00", invoiceAmount: "900.00", currencyCode: "USD" });
  const proof = await db.paymentDocument.create({ data: { ownerId: ap.user.id, requestId: paid.id, kind: "PAYMENT_PROOF", filename: "proof.pdf", storageKey: `proof-${suffix}`, mimeType: "application/pdf", sizeBytes: 100 } });
  await db.paymentConfirmation.create({
    data: {
      requestId: paid.id, amountPaid: "880", currencyCode: "USD", amountPaidUsd: "880", exchangeRate: "1", exchangeRateSource: "seed",
      actualPaymentDate: dayAgo(2), paymentReference: `REF-${suffix}`, paymentMethod: "Bank transfer", paymentAccount: "ACCT-0001",
      proofDocumentId: proof.id, processedById: ap.user.id,
    },
  });
}

test("management dashboard requires the reports:access permission", async () => {
  await seedScenario();
  assert.equal((await api("/api/management/dashboard", requestor.cookie)).status, 403);
  assert.equal((await api("/api/management/dashboard", manager.cookie)).status, 200);
});

test("KPIs are computed from real records and scoped by filters", async () => {
  const response = await api(`/api/management/dashboard?vendor=${vendorTag}`, manager.cookie);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.kpis.pendingApprovals.count, 1);
  assert.equal(body.kpis.approvedWaiting.count, 2); // overdue + upcoming
  assert.equal(body.kpis.overdue.count, 1);
  assert.equal(body.kpis.overdue.usd, "1000.00");
  assert.equal(body.kpis.totalPaid.count, 1);
  assert.equal(body.kpis.totalPaid.usd, "880.00"); // confirmed amount, not request value
  assert.equal(body.kpis.totalOutstanding.usd, "3000.00"); // 1000 + 2000 approved unpaid
  assert.equal(body.kpis.totalRequests.count, 4);
});

test("approval aging, overdue, and upcoming reports reflect the records", async () => {
  const aging = await api(`/api/management/reports/aging?vendor=${vendorTag}`, manager.cookie).then((response) => response.json());
  assert.equal(aging.rows.length, 1);
  assert.equal(aging.rows[0].bucket, "24-48"); // assigned ~30h ago
  assert.ok(aging.rows[0].id, "aging rows expose id for drill-down");

  const overdue = await api(`/api/management/reports/overdue?vendor=${vendorTag}`, manager.cookie).then((response) => response.json());
  assert.equal(overdue.count, 1);
  assert.ok(overdue.rows[0].daysOverdue >= 4);

  const upcoming = await api(`/api/management/reports/upcoming?vendor=${vendorTag}`, manager.cookie).then((response) => response.json());
  assert.equal(upcoming.count, 1);
});

test("project and vendor reports aggregate USD values", async () => {
  const vendor = await api(`/api/management/reports/vendor?vendor=${vendorTag}`, manager.cookie).then((response) => response.json());
  const row = vendor.items.find((item: { vendorName: string }) => item.vendorName === vendorTag);
  assert.ok(row);
  assert.equal(row.totalInvoices, 4);
  assert.equal(row.totalPaidUsd, "880.00");

  const project = await api(`/api/management/reports/project?vendor=${vendorTag}`, manager.cookie).then((response) => response.json());
  assert.ok(Array.isArray(project.items));
});

test("reports export to CSV, XLSX, and PDF with correct content types", async () => {
  const checks: Array<[string, string, string]> = [
    ["csv", "text/csv", "PK-or-text"],
    ["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "PK"],
    ["pdf", "application/pdf", "%PDF"],
  ];
  for (const [format, contentType, magic] of checks) {
    const response = await api(`/api/management/reports/history?vendor=${vendorTag}&format=${format}`, manager.cookie);
    assert.equal(response.status, 200, `${format} export status`);
    assert.ok(response.headers.get("content-type")?.includes(contentType), `${format} content-type`);
    assert.match(response.headers.get("content-disposition") ?? "", /attachment; filename=/);
    const buffer = Buffer.from(await response.arrayBuffer());
    assert.ok(buffer.length > 0, `${format} has bytes`);
    if (magic === "PK") assert.equal(buffer.slice(0, 2).toString(), "PK");
    if (magic === "%PDF") assert.equal(buffer.slice(0, 4).toString(), "%PDF");
  }
});

test("date-range filters narrow the result set", async () => {
  // All scenario requests were submitted 3 days ago; a window before that returns none.
  const from = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
  const to = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const body = await api(`/api/management/dashboard?vendor=${vendorTag}&from=${from}&to=${to}`, manager.cookie).then((response) => response.json());
  assert.equal(body.kpis.totalRequests.count, 0);
});
