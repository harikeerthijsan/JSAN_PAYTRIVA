import assert from "node:assert/strict";
import { test } from "node:test";
import {
  agingBucket,
  computeAging,
  computeCurrencyReport,
  computeKpis,
  computeOverdue,
  computeProjectReport,
  computeUpcoming,
  computeVendorReport,
  financialYearRange,
  previousPeriod,
  type ReportRecord,
} from "./report-calcs";

const now = new Date("2026-06-15T12:00:00.000Z");
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function record(overrides: Partial<ReportRecord>): ReportRecord {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    transactionId: overrides.transactionId ?? "PTR-X",
    status: overrides.status ?? "APPROVED",
    vendorName: overrides.vendorName ?? "Acme",
    invoiceNumber: overrides.invoiceNumber ?? "INV-1",
    finalValueUsd: overrides.finalValueUsd ?? "1000",
    invoiceAmount: overrides.invoiceAmount ?? "1000",
    currencyCode: overrides.currencyCode ?? "USD",
    projectId: overrides.projectId ?? "p1",
    projectName: overrides.projectName ?? "Project One",
    costCenterName: overrides.costCenterName ?? "CC-1",
    entityName: overrides.entityName ?? "JSAN",
    dueDate: overrides.dueDate ?? null,
    submittedAt: overrides.submittedAt ?? day("2026-06-01"),
    createdAt: overrides.createdAt ?? day("2026-06-01"),
    paidUsd: overrides.paidUsd ?? null,
    actualPaymentDate: overrides.actualPaymentDate ?? null,
    scheduledDate: overrides.scheduledDate ?? null,
    earliestEligibleDate: overrides.earliestEligibleDate ?? null,
    riskStatus: overrides.riskStatus ?? null,
    approverId: overrides.approverId ?? null,
    approverName: overrides.approverName ?? null,
    assignedAt: overrides.assignedAt ?? null,
    assignmentResolvedAt: overrides.assignmentResolvedAt ?? null,
  };
}

test("JSAN financial year runs April to March", () => {
  const range = financialYearRange(2026);
  assert.equal(range.from.toISOString().slice(0, 10), "2026-04-01");
  assert.equal(range.to.toISOString().slice(0, 10), "2027-03-31");
});

test("aging buckets use 8/24/48 hour thresholds", () => {
  assert.equal(agingBucket(0), "0-8");
  assert.equal(agingBucket(7.9), "0-8");
  assert.equal(agingBucket(8), "8-24");
  assert.equal(agingBucket(23.9), "8-24");
  assert.equal(agingBucket(24), "24-48");
  assert.equal(agingBucket(47.9), "24-48");
  assert.equal(agingBucket(48), "48+");
  assert.equal(agingBucket(500), "48+");
});

test("previous period mirrors the selected window length", () => {
  const prev = previousPeriod(day("2026-04-01"), day("2026-04-30"));
  assert.ok(prev.to.getTime() < day("2026-04-01").getTime());
  assert.ok(prev.from.getTime() < prev.to.getTime());
});

test("KPIs separate open AP, paid, overdue, and outstanding without double counting currencies", () => {
  const records: ReportRecord[] = [
    record({ status: "PENDING_APPROVAL", finalValueUsd: "500" }),
    record({ status: "APPROVED", finalValueUsd: "1000", dueDate: day("2026-05-01"), scheduledDate: day("2026-05-06") }), // overdue
    record({ status: "APPROVED", finalValueUsd: "2000", scheduledDate: day("2026-06-17"), dueDate: day("2026-12-01") }), // upcoming
    record({ status: "PAID", finalValueUsd: "4000", paidUsd: "3900", actualPaymentDate: day("2026-06-10") }),
  ];
  const kpis = computeKpis(records, now);
  assert.equal(kpis.totalPaid.usd, "3900.00"); // confirmed payment amount, not the request value
  assert.equal(kpis.totalPaid.count, 1);
  assert.equal(kpis.pendingApprovals.count, 1);
  assert.equal(kpis.approvedWaiting.count, 2);
  assert.equal(kpis.totalOutstanding.usd, "3000.00"); // 1000 + 2000 approved unpaid
  assert.equal(kpis.overdue.usd, "1000.00");
  assert.equal(kpis.overdue.count, 1);
  assert.equal(kpis.totalOpenAp.count, 3); // pending + 2 approved, excludes paid
  assert.equal(kpis.totalRequests.count, 4);
});

test("currency report keeps original and USD values separate per currency", () => {
  const rows = computeCurrencyReport([
    record({ currencyCode: "EUR", invoiceAmount: "100", finalValueUsd: "110" }),
    record({ currencyCode: "EUR", invoiceAmount: "50", finalValueUsd: "55" }),
    record({ currencyCode: "USD", invoiceAmount: "200", finalValueUsd: "200" }),
  ]);
  const eur = rows.find((row) => row.code === "EUR")!;
  assert.equal(eur.totalOriginal, "150.00");
  assert.equal(eur.totalUsd, "165.00");
  assert.equal(eur.count, 2);
});

test("project report totals requested, approved, paid, outstanding, and overdue", () => {
  const rows = computeProjectReport([
    record({ projectId: "p1", projectName: "Alpha", status: "APPROVED", finalValueUsd: "1000", dueDate: day("2026-05-01"), scheduledDate: day("2026-05-02") }),
    record({ projectId: "p1", projectName: "Alpha", status: "PAID", finalValueUsd: "500", paidUsd: "480" }),
  ], now);
  const alpha = rows.find((row) => row.projectName === "Alpha")!;
  assert.equal(alpha.totalInvoices, 2);
  assert.equal(alpha.totalRequestedUsd, "1500.00");
  assert.equal(alpha.totalApprovedUsd, "1500.00"); // approved + paid both count toward approved
  assert.equal(alpha.totalPaidUsd, "480.00");
  assert.equal(alpha.outstandingUsd, "1020.00"); // approved(1500) - paid(480)
  assert.equal(alpha.overdueUsd, "1000.00");
});

test("vendor report tracks paid, pending, overdue, and last payment date", () => {
  const rows = computeVendorReport([
    record({ vendorName: "Globex", status: "PAID", finalValueUsd: "1000", paidUsd: "1000", actualPaymentDate: day("2026-05-20") }),
    record({ vendorName: "Globex", status: "PAID", finalValueUsd: "500", paidUsd: "500", actualPaymentDate: day("2026-06-01") }),
    record({ vendorName: "Globex", status: "APPROVED", finalValueUsd: "800", dueDate: day("2026-05-01"), scheduledDate: day("2026-05-02") }),
  ], now);
  const globex = rows.find((row) => row.vendorName === "Globex")!;
  assert.equal(globex.totalInvoices, 3);
  assert.equal(globex.totalPaidUsd, "1500.00");
  assert.equal(globex.pendingPaymentsUsd, "800.00");
  assert.equal(globex.overduePaymentsUsd, "800.00");
  assert.equal(globex.lastPaymentDate, "2026-06-01");
});

test("approval aging buckets pending approvals and flags delays over 48h", () => {
  const records: ReportRecord[] = [
    record({ status: "PENDING_APPROVAL", assignedAt: new Date(now.getTime() - 2 * 3_600_000) }),
    record({ status: "PENDING_APPROVAL", assignedAt: new Date(now.getTime() - 30 * 3_600_000) }),
    record({ status: "PENDING_APPROVAL", assignedAt: new Date(now.getTime() - 72 * 3_600_000) }),
    record({ status: "APPROVED", assignedAt: new Date(now.getTime() - 100 * 3_600_000), assignmentResolvedAt: now }),
  ];
  const aging = computeAging(records, now);
  assert.equal(aging.rows.length, 3); // only pending, resolved approvals excluded
  assert.deepEqual(aging.buckets, { "0-8": 1, "8-24": 0, "24-48": 1, "48+": 1 });
  assert.equal(aging.rows[0].delayed, true); // sorted longest-waiting first
});

test("overdue uses invoice due date; upcoming uses scheduled date", () => {
  const records: ReportRecord[] = [
    record({ status: "APPROVED", finalValueUsd: "700", dueDate: day("2026-05-01"), scheduledDate: day("2026-05-02") }),
    record({ status: "APPROVED", finalValueUsd: "300", scheduledDate: day("2026-06-24"), dueDate: day("2026-12-01") }),
    record({ status: "PENDING_APPROVAL", dueDate: day("2026-01-01") }), // not approved -> never overdue
  ];
  const overdue = computeOverdue(records, now);
  assert.equal(overdue.count, 1);
  assert.equal(overdue.totalUsd, "700.00");
  assert.ok(overdue.rows[0].daysOverdue > 0);

  const upcoming = computeUpcoming(records, now);
  assert.equal(upcoming.count, 1);
  assert.equal(upcoming.rows[0].scheduledDate, "2026-06-24");
});
