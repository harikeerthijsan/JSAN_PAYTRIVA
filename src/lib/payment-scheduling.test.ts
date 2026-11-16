import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computePaymentSchedule,
  derivePaymentCategory,
  earliestEligiblePaymentDate,
  nextWednesdayOnOrAfter,
  toIsoDay,
  upcomingWednesdays,
} from "./payment-scheduling";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

test("required case: submission 04-Nov-2026 (Wed) schedules on 11-Nov-2026 (Wed)", () => {
  const result = computePaymentSchedule({ submissionDate: day("2026-11-04") });
  assert.equal(toIsoDay(result.earliestEligibleDate), "2026-11-11");
  assert.equal(toIsoDay(result.scheduledPaymentDate), "2026-11-11");
  assert.equal(result.riskStatus, "ON_TRACK");
});

test("earliest eligible date always adds exactly seven calendar days", () => {
  assert.equal(toIsoDay(earliestEligiblePaymentDate(day("2026-11-04"))), "2026-11-11");
  assert.equal(toIsoDay(earliestEligiblePaymentDate(day("2026-03-01"))), "2026-03-08");
  // Ignores the submission time of day.
  assert.equal(toIsoDay(earliestEligiblePaymentDate(new Date("2026-11-04T23:59:59.000Z"))), "2026-11-11");
});

test("scheduling rolls forward to the next Wednesday for every submission weekday", () => {
  // Earliest eligible = submission + 7 days, then the next Wednesday on/after it.
  const cases: Array<[string, string]> = [
    ["2026-11-01", "2026-11-11"], // Sun -> eligible Sun 08 -> Wed 11
    ["2026-11-02", "2026-11-11"], // Mon -> eligible Mon 09 -> Wed 11
    ["2026-11-03", "2026-11-11"], // Tue -> eligible Tue 10 -> Wed 11
    ["2026-11-04", "2026-11-11"], // Wed -> eligible Wed 11 -> Wed 11
    ["2026-11-05", "2026-11-18"], // Thu -> eligible Thu 12 -> Wed 18
    ["2026-11-06", "2026-11-18"], // Fri -> eligible Fri 13 -> Wed 18
    ["2026-11-07", "2026-11-18"], // Sat -> eligible Sat 14 -> Wed 18
  ];
  for (const [submission, expected] of cases) {
    assert.equal(toIsoDay(computePaymentSchedule({ submissionDate: day(submission) }).scheduledPaymentDate), expected, submission);
  }
});

test("seven-day minimum is enforced even when submission day is a Wednesday", () => {
  // A Wednesday submission is NOT payable on the immediately following Wednesday (only 7 days
  // later, which lands exactly on the next Wednesday), never the same week.
  const result = computePaymentSchedule({ submissionDate: day("2026-11-04") });
  assert.ok(result.scheduledPaymentDate.getTime() - day("2026-11-04").getTime() >= 7 * 86_400_000);
});

test("nextWednesdayOnOrAfter returns the same date when already a Wednesday", () => {
  assert.equal(toIsoDay(nextWednesdayOnOrAfter(day("2026-11-11"))), "2026-11-11");
  assert.equal(toIsoDay(nextWednesdayOnOrAfter(day("2026-11-12"))), "2026-11-18");
});

test("month-end submission crosses into the next month correctly", () => {
  // 28-Nov-2026 (Sat) + 7 = 05-Dec-2026 (Sat) -> next Wed 09-Dec-2026.
  const result = computePaymentSchedule({ submissionDate: day("2026-11-28") });
  assert.equal(toIsoDay(result.earliestEligibleDate), "2026-12-05");
  assert.equal(toIsoDay(result.scheduledPaymentDate), "2026-12-09");
});

test("year-end submission crosses into the next year correctly", () => {
  // 30-Dec-2026 (Wed) + 7 = 06-Jan-2027 (Wed) -> schedules on 06-Jan-2027.
  const result = computePaymentSchedule({ submissionDate: day("2026-12-30") });
  assert.equal(toIsoDay(result.earliestEligibleDate), "2027-01-06");
  assert.equal(toIsoDay(result.scheduledPaymentDate), "2027-01-06");
});

test("flags at risk when the earliest eligible Wednesday falls after the invoice due date", () => {
  const result = computePaymentSchedule({ submissionDate: day("2026-11-04"), dueDate: day("2026-11-09") });
  assert.equal(toIsoDay(result.scheduledPaymentDate), "2026-11-11");
  assert.equal(result.meetsDueDate, false);
  assert.equal(result.riskStatus, "AT_RISK");
});

test("stays on track when the scheduled Wednesday is on or before the due date", () => {
  const onDue = computePaymentSchedule({ submissionDate: day("2026-11-04"), dueDate: day("2026-11-11") });
  assert.equal(onDue.riskStatus, "ON_TRACK");
  const afterDue = computePaymentSchedule({ submissionDate: day("2026-11-04"), dueDate: day("2026-12-01") });
  assert.equal(afterDue.riskStatus, "ON_TRACK");
});

test("upcoming Wednesdays enumerate the weekly cycle", () => {
  assert.deepEqual(
    upcomingWednesdays(day("2026-11-10"), 4).map(toIsoDay),
    ["2026-11-11", "2026-11-18", "2026-11-25", "2026-12-02"],
  );
});

test("category derivation: pending approval is never overdue", () => {
  const category = derivePaymentCategory({
    isPaid: false,
    isApproved: false,
    dueDate: day("2026-01-01"),
    now: day("2026-06-01"),
  });
  assert.equal(category, "UNSCHEDULED");
});

test("category derivation: approved, past due, and unpaid is overdue", () => {
  assert.equal(
    derivePaymentCategory({ isPaid: false, isApproved: true, dueDate: day("2026-05-01"), scheduledPaymentDate: day("2026-05-06"), now: day("2026-06-01") }),
    "OVERDUE",
  );
});

test("category derivation: completed, at-risk, due-this-week, and upcoming", () => {
  assert.equal(derivePaymentCategory({ isPaid: true, isApproved: true, now: day("2026-06-01") }), "COMPLETED");
  assert.equal(
    derivePaymentCategory({ isPaid: false, isApproved: true, riskStatus: "AT_RISK", dueDate: day("2026-06-10"), scheduledPaymentDate: day("2026-06-17"), now: day("2026-06-01") }),
    "AT_RISK",
  );
  assert.equal(
    derivePaymentCategory({ isPaid: false, isApproved: true, scheduledPaymentDate: day("2026-06-03"), dueDate: day("2026-06-30"), now: day("2026-06-01") }),
    "DUE_THIS_WEEK",
  );
  assert.equal(
    derivePaymentCategory({ isPaid: false, isApproved: true, scheduledPaymentDate: day("2026-06-24"), dueDate: day("2026-06-30"), now: day("2026-06-01") }),
    "UPCOMING",
  );
});
