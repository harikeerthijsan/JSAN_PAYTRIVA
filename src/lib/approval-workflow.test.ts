import assert from "node:assert/strict";
import test from "node:test";
import { approvalBandForValue, approvalBandProblem } from "@/lib/approval-workflow";

const bands = [
  { id: "low", label: "Below $5,000", minUsd: "0", maxUsdExclusive: "5000", assignedApproverId: "braj-user", isActive: true },
  { id: "mid", label: "$5,000 - $39,999.99", minUsd: "5000", maxUsdExclusive: "40000", assignedApproverId: "satish-user", isActive: true },
  { id: "pending", label: "$40,000 - $49,999.99 (business confirmation required)", minUsd: "40000", maxUsdExclusive: "50000", assignedApproverId: null, isActive: true },
  { id: "high", label: "$50,000 and above", minUsd: "50000", maxUsdExclusive: null, assignedApproverId: "ram-user", isActive: true },
];

test("USD approval matrix applies exact inclusive and exclusive boundaries", () => {
  assert.equal(approvalBandForValue("4999.999999", bands)?.id, "low");
  assert.equal(approvalBandForValue("5000", bands)?.id, "mid");
  assert.equal(approvalBandForValue("39999.999999", bands)?.id, "mid");
  assert.equal(approvalBandForValue("40000", bands)?.id, "pending");
  assert.equal(approvalBandForValue("49999.999999", bands)?.id, "pending");
  assert.equal(approvalBandForValue("50000", bands)?.id, "high");
});

test("unconfirmed USD band blocks routing until an approver is configured", () => {
  assert.match(approvalBandProblem("45000", bands) ?? "", /pending business confirmation/i);
  const configured = bands.map((band) => band.id === "pending" ? { ...band, assignedApproverId: "confirmed-user" } : band);
  assert.equal(approvalBandProblem("45000", configured), null);
});

test("missing and overlapping active bands are reported as configuration errors", () => {
  assert.match(approvalBandProblem("1000", bands.slice(1)) ?? "", /no unique approval threshold/i);
  const overlapping = [...bands, { ...bands[0], id: "overlap" }];
  assert.equal(approvalBandForValue("1000", overlapping), null);
  assert.match(approvalBandProblem("1000", overlapping) ?? "", /no unique approval threshold/i);
});
