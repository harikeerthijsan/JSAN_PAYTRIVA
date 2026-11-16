/**
 * PAYTRIVA demo data seeder (LOCAL/DEV ONLY).
 *
 * Creates realistic, properly-structured sample records tagged `PTR-DEMO-*` so the
 * calendar, dashboard, and reports show genuine aggregations. Re-running first removes
 * any previous PTR-DEMO data. This is NOT for production.
 *
 *   npx tsx --conditions=react-server scripts/demo-seed.ts
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { PaymentStatus, Prisma } from "../src/generated/prisma/client";
import { db } from "../src/lib/db";

const EUR_RATE = "1.08";
const vendors = ["Globex Corp", "Initech LLC", "Umbrella Supplies", "Stark Industries", "Wayne Enterprises", "Acme Services", "Soylent Foods", "Hooli Tech"];

const utcDay = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const daysAhead = (n: number) => new Date(Date.now() + n * 86_400_000);
const monthsAgo = (n: number) => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() - n); return d; };
function nextWednesday(from: Date): Date {
  const d = utcDay(from);
  return new Date(d.getTime() + (((3 - d.getUTCDay() + 7) % 7)) * 86_400_000);
}

async function ensureUser(email: string, fullName: string, roleKey: string, password: string) {
  const hash = await bcrypt.hash(password, 12);
  const user = await db.user.upsert({
    where: { email },
    create: { email, fullName, passwordHash: hash, isActive: true, activatedAt: new Date() },
    update: { fullName, passwordHash: hash, isActive: true, activatedAt: new Date() },
  });
  const role = await db.role.findUniqueOrThrow({ where: { key: roleKey } });
  if (!(await db.userRole.findFirst({ where: { userId: user.id, roleId: role.id } }))) {
    await db.userRole.create({ data: { userId: user.id, roleId: role.id } });
  }
  return user;
}

async function main() {
  console.info("Seeding PAYTRIVA demo data…");

  // 1) Remove previous demo data (confirmations first due to Restrict FK).
  const prior = await db.paymentRequest.findMany({ where: { transactionId: { startsWith: "PTR-DEMO-" } }, select: { id: true } });
  if (prior.length) {
    const ids = prior.map((r) => r.id);
    await db.paymentConfirmation.deleteMany({ where: { requestId: { in: ids } } });
    await db.paymentRequest.deleteMany({ where: { id: { in: ids } } });
    console.info(`Removed ${ids.length} previous demo requests.`);
  }

  // `--clear` removes demo data without reseeding (e.g. before running the integration suite).
  if (process.argv.includes("--clear")) {
    console.info("Demo data cleared.");
    await db.$disconnect();
    return;
  }

  // 2) Currencies + rates (USD per 1 unit). Rates are illustrative for the demo.
  await db.paymentCurrency.upsert({ where: { code: "EUR" }, create: { code: "EUR", name: "Euro", symbol: "€", decimalPlaces: 2 }, update: { isActive: true } });
  await db.paymentCurrency.upsert({ where: { code: "GBP" }, create: { code: "GBP", name: "British Pound", symbol: "£", decimalPlaces: 2 }, update: { isActive: true } });
  for (const [code, usdPerUnit] of [["EUR", EUR_RATE], ["GBP", "1.27"]] as const) {
    await db.currencyExchangeRate.upsert({
      where: { currencyCode_source_effectiveAt: { currencyCode: code, source: "Demo seed", effectiveAt: monthsAgo(6) } },
      create: { currencyCode: code, usdPerUnit, source: "Demo seed", effectiveAt: monthsAgo(6) },
      update: {},
    });
  }

  // 3) Master data.
  const entity = await db.paymentEntity.upsert({ where: { code: "DEMO-ENT" }, create: { name: "JSAN Consulting (Demo)", code: "DEMO-ENT" }, update: { isActive: true } });
  const projects = await Promise.all([
    db.paymentProject.upsert({ where: { code: "DEMO-APL" }, create: { name: "Project Apollo", code: "DEMO-APL" }, update: { isActive: true } }),
    db.paymentProject.upsert({ where: { code: "DEMO-HEL" }, create: { name: "Project Helios", code: "DEMO-HEL" }, update: { isActive: true } }),
    db.paymentProject.upsert({ where: { code: "DEMO-ORI" }, create: { name: "Project Orion", code: "DEMO-ORI" }, update: { isActive: true } }),
  ]);
  const costCenters = await Promise.all([
    db.costCenter.upsert({ where: { code: "DEMO-OPS" }, create: { name: "Operations", code: "DEMO-OPS" }, update: { isActive: true } }),
    db.costCenter.upsert({ where: { code: "DEMO-ENG" }, create: { name: "Engineering", code: "DEMO-ENG" }, update: { isActive: true } }),
  ]);

  // 4) Users.
  const requestor = await ensureUser("request@jsanconsulting.com", "Test Requestor", "REQUESTOR", "Requestor!2026");
  const approver = await ensureUser("approver@jsanconsulting.com", "Dana Approver", "APPROVER", "Approver!2026");
  const ap = await db.user.findUniqueOrThrow({ where: { email: "admin@paytriva.local" } });

  // 5) Assign approver to active bands so the workflow can route (demo convenience).
  await db.approvalThreshold.updateMany({ where: { isActive: true }, data: { assignedApproverId: approver.id } });
  const band = await db.approvalThreshold.findFirstOrThrow({ where: { isActive: true }, orderBy: { minUsd: "asc" } });

  let seq = 0;
  type Opts = {
    status: PaymentStatus;
    amount: string; tax?: string; currency?: "USD" | "EUR";
    projectIndex?: number; costIndex?: number; vendorIndex?: number;
    submittedAt?: Date | null; dueDate?: Date | null;
    scheduledDate?: Date | null; riskStatus?: "ON_TRACK" | "AT_RISK";
    assignedAt?: Date | null; resolvedAt?: Date | null;
    paidAt?: Date | null; comment?: string;
  };

  async function createRequest(o: Opts) {
    seq += 1;
    const id4 = String(seq).padStart(4, "0");
    const currency = o.currency ?? "USD";
    const rate = currency === "EUR" ? new Prisma.Decimal(EUR_RATE) : new Prisma.Decimal(1);
    const amount = new Prisma.Decimal(o.amount);
    const tax = new Prisma.Decimal(o.tax ?? "0");
    const total = amount.plus(tax);
    const vendor = vendors[(o.vendorIndex ?? seq) % vendors.length];
    const project = projects[(o.projectIndex ?? seq) % projects.length];
    const cost = costCenters[(o.costIndex ?? seq) % costCenters.length];
    const invoiceDate = o.submittedAt ? utcDay(new Date(o.submittedAt.getTime() - 2 * 86_400_000)) : daysAgo(2);

    const request = await db.paymentRequest.create({
      data: {
        transactionId: `PTR-DEMO-${id4}`,
        requestorId: requestor.id,
        status: o.status,
        vendorName: vendor,
        invoiceNumber: `INV-DEMO-${id4}`,
        description: `${project.name} — ${vendor} services`,
        billToEntityId: entity.id,
        projectId: project.id,
        costCenterId: cost.id,
        currencyCode: currency,
        invoiceAmount: amount,
        taxAmount: tax,
        totalPayable: total,
        invoiceAmountUsd: amount.mul(rate),
        finalValueUsd: total.mul(rate),
        exchangeRate: rate,
        exchangeRateSource: currency === "EUR" ? "Demo seed" : "USD base currency",
        conversionDate: invoiceDate,
        invoiceDate,
        dueDate: o.dueDate ?? null,
        submittedAt: o.submittedAt ?? null,
      },
    });

    const historyRows: Prisma.PaymentRequestHistoryCreateManyInput[] = [];
    if (o.submittedAt) historyRows.push({ requestId: request.id, actorId: requestor.id, action: "SUBMITTED", toStatus: PaymentStatus.PENDING_REVIEW, description: "Submitted for AP review.", createdAt: o.submittedAt });

    // Approval assignment for anything that reached approval.
    if (o.assignedAt) {
      await db.approvalAssignment.create({ data: { requestId: request.id, approverId: approver.id, thresholdId: band.id, assignedAt: o.assignedAt, resolvedAt: o.resolvedAt ?? null } });
      historyRows.push({ requestId: request.id, actorId: ap.id, action: "FORWARDED_FOR_APPROVAL", toStatus: PaymentStatus.PENDING_APPROVAL, description: "Forwarded to approver.", createdAt: o.assignedAt });
    }

    // Payment schedule for approved/paid.
    if (o.scheduledDate) {
      await db.paymentSchedule.create({
        data: {
          requestId: request.id,
          plannedDate: utcDay(o.scheduledDate),
          earliestEligibleDate: o.submittedAt ? utcDay(new Date(o.submittedAt.getTime() + 7 * 86_400_000)) : utcDay(daysAgo(0)),
          riskStatus: o.riskStatus ?? "ON_TRACK",
          autoScheduled: true,
          createdById: ap.id,
        },
      });
    }

    if (o.status === PaymentStatus.APPROVED) historyRows.push({ requestId: request.id, actorId: approver.id, action: "APPROVE", fromStatus: PaymentStatus.PENDING_APPROVAL, toStatus: PaymentStatus.APPROVED, description: "Approved.", createdAt: o.resolvedAt ?? new Date() });
    if (o.status === PaymentStatus.REJECTED) historyRows.push({ requestId: request.id, actorId: approver.id, action: "REJECT", fromStatus: PaymentStatus.PENDING_APPROVAL, toStatus: PaymentStatus.REJECTED, description: o.comment ?? "Rejected.", createdAt: o.resolvedAt ?? new Date() });
    if (o.status === PaymentStatus.NEEDS_INFORMATION) {
      await db.clarificationRequest.create({ data: { requestId: request.id, createdById: ap.id, reason: o.comment ?? "Please attach a corrected invoice." } });
      historyRows.push({ requestId: request.id, actorId: ap.id, action: "CLARIFICATION", toStatus: PaymentStatus.NEEDS_INFORMATION, description: o.comment ?? "Clarification requested.", createdAt: new Date() });
    }

    // Payment confirmation for paid.
    if (o.status === PaymentStatus.PAID && o.paidAt) {
      const proof = await db.paymentDocument.create({ data: { requestId: request.id, ownerId: ap.id, kind: "PAYMENT_PROOF", filename: `proof-${id4}.pdf`, storageKey: `demo-proof-${request.id}`, mimeType: "application/pdf", sizeBytes: 2048 } });
      await db.paymentConfirmation.create({
        data: {
          requestId: request.id,
          amountPaid: total, currencyCode: currency, amountPaidUsd: total.mul(rate),
          exchangeRate: rate, exchangeRateSource: currency === "EUR" ? "Demo seed" : "USD base currency",
          actualPaymentDate: utcDay(o.paidAt), paymentReference: `PAY-DEMO-${id4}`, paymentMethod: "Bank transfer", paymentAccount: "ACCT-DEMO-0001",
          proofDocumentId: proof.id, processedById: ap.id,
        },
      });
      historyRows.push({ requestId: request.id, actorId: ap.id, action: "PAYMENT_CONFIRMED", fromStatus: PaymentStatus.APPROVED, toStatus: PaymentStatus.PAID, description: `Paid. Reference PAY-DEMO-${id4}.`, createdAt: o.paidAt });
    }

    if (historyRows.length) await db.paymentRequestHistory.createMany({ data: historyRows });
    return request;
  }

  // 6) A spread across every state.
  // Drafts (owned by requestor)
  await createRequest({ status: PaymentStatus.DRAFT, amount: "1200" });
  await createRequest({ status: PaymentStatus.DRAFT, amount: "850", currency: "EUR" });
  // Pending review
  await createRequest({ status: PaymentStatus.PENDING_REVIEW, amount: "3200", submittedAt: daysAgo(1) });
  await createRequest({ status: PaymentStatus.PENDING_REVIEW, amount: "15400", submittedAt: daysAgo(2) });
  // Pending approval (aging buckets: 2h, 30h, 72h)
  await createRequest({ status: PaymentStatus.PENDING_APPROVAL, amount: "2450", submittedAt: daysAgo(1), assignedAt: new Date(Date.now() - 2 * 3_600_000), dueDate: daysAhead(25) });
  await createRequest({ status: PaymentStatus.PENDING_APPROVAL, amount: "7800", currency: "EUR", submittedAt: daysAgo(2), assignedAt: new Date(Date.now() - 30 * 3_600_000), dueDate: daysAhead(20) });
  await createRequest({ status: PaymentStatus.PENDING_APPROVAL, amount: "52000", submittedAt: daysAgo(4), assignedAt: new Date(Date.now() - 72 * 3_600_000), dueDate: daysAhead(18) });
  // Approved + upcoming
  await createRequest({ status: PaymentStatus.APPROVED, amount: "4300", submittedAt: daysAgo(6), assignedAt: daysAgo(5), resolvedAt: daysAgo(4), scheduledDate: nextWednesday(daysAhead(3)), dueDate: daysAhead(30) });
  await createRequest({ status: PaymentStatus.APPROVED, amount: "9900", currency: "EUR", submittedAt: daysAgo(7), assignedAt: daysAgo(6), resolvedAt: daysAgo(5), scheduledDate: nextWednesday(daysAhead(8)), dueDate: daysAhead(40) });
  await createRequest({ status: PaymentStatus.APPROVED, amount: "60000", submittedAt: daysAgo(8), assignedAt: daysAgo(7), resolvedAt: daysAgo(6), scheduledDate: nextWednesday(daysAhead(10)), dueDate: daysAhead(45) });
  // Approved + overdue (due date in the past)
  await createRequest({ status: PaymentStatus.APPROVED, amount: "2100", submittedAt: daysAgo(20), assignedAt: daysAgo(18), resolvedAt: daysAgo(17), scheduledDate: utcDay(daysAgo(5)), dueDate: daysAgo(3) });
  await createRequest({ status: PaymentStatus.APPROVED, amount: "6700", submittedAt: daysAgo(25), assignedAt: daysAgo(23), resolvedAt: daysAgo(22), scheduledDate: utcDay(daysAgo(8)), dueDate: daysAgo(6) });
  // Approved + at risk (scheduled after due date)
  await createRequest({ status: PaymentStatus.APPROVED, amount: "3800", submittedAt: daysAgo(2), assignedAt: daysAgo(1), resolvedAt: daysAgo(1), scheduledDate: nextWednesday(daysAhead(9)), dueDate: daysAhead(3), riskStatus: "AT_RISK" });
  // Paid (spread across months for trends)
  await createRequest({ status: PaymentStatus.PAID, amount: "5400", submittedAt: monthsAgo(3), assignedAt: monthsAgo(3), resolvedAt: monthsAgo(3), scheduledDate: monthsAgo(3), paidAt: monthsAgo(3) });
  await createRequest({ status: PaymentStatus.PAID, amount: "12800", currency: "EUR", submittedAt: monthsAgo(2), assignedAt: monthsAgo(2), resolvedAt: monthsAgo(2), scheduledDate: monthsAgo(2), paidAt: monthsAgo(2) });
  await createRequest({ status: PaymentStatus.PAID, amount: "3300", submittedAt: monthsAgo(1), assignedAt: monthsAgo(1), resolvedAt: monthsAgo(1), scheduledDate: monthsAgo(1), paidAt: monthsAgo(1) });
  await createRequest({ status: PaymentStatus.PAID, amount: "8100", submittedAt: daysAgo(12), assignedAt: daysAgo(11), resolvedAt: daysAgo(10), scheduledDate: utcDay(daysAgo(7)), paidAt: daysAgo(7) });
  // Rejected
  await createRequest({ status: PaymentStatus.REJECTED, amount: "4200", submittedAt: daysAgo(9), assignedAt: daysAgo(8), resolvedAt: daysAgo(8), comment: "Duplicate of an earlier invoice." });
  // Needs clarification
  await createRequest({ status: PaymentStatus.NEEDS_INFORMATION, amount: "1850", submittedAt: daysAgo(3), comment: "Invoice total does not match the line items." });

  const total = await db.paymentRequest.count({ where: { transactionId: { startsWith: "PTR-DEMO-" } } });
  console.info(`Done. ${total} demo payment requests created across all statuses.`);
  console.info("Requestor: request@jsanconsulting.com / Requestor!2026");
  console.info("Approver:  approver@jsanconsulting.com / Approver!2026");
  console.info("AP/Admin:  admin@paytriva.local / Paytriva!Admin2026");
  await db.$disconnect();
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
