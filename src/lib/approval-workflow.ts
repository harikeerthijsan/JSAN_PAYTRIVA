const scale = BigInt(1_000_000);

function toMicros(value: string): bigint | null {
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(value);
  if (!match) return null;
  return BigInt(match[1]) * scale + BigInt((match[2] ?? "").padEnd(6, "0"));
}

export type ApprovalBand = {
  id: string;
  label: string;
  minUsd: string;
  maxUsdExclusive: string | null;
  assignedApproverId: string | null;
  isActive: boolean;
};

export function approvalBandForValue<T extends ApprovalBand>(valueUsd: string, bands: T[]): T | null {
  const value = toMicros(valueUsd);
  if (value === null) return null;
  const matches = bands.filter((band) => {
    if (!band.isActive) return false;
    const min = toMicros(band.minUsd);
    const max = band.maxUsdExclusive === null ? null : toMicros(band.maxUsdExclusive);
    return min !== null && value >= min && (max === null || (max !== null && value < max));
  });
  return matches.length === 1 ? matches[0] : null;
}

export function approvalBandProblem(valueUsd: string, bands: ApprovalBand[]): string | null {
  const value = toMicros(valueUsd);
  if (value === null) return "The final USD amount is invalid; approval routing cannot continue.";
  const matching = bands.filter((band) => {
    const min = toMicros(band.minUsd);
    const max = band.maxUsdExclusive === null ? null : toMicros(band.maxUsdExclusive);
    return band.isActive && min !== null && value >= min && (max === null || (max !== null && value < max));
  });
  if (matching.length !== 1) return "No unique approval threshold is configured for this USD amount. Ask an administrator to review the approval matrix.";
  if (!matching[0].assignedApproverId) {
    if (matching[0].minUsd === "40000" && matching[0].maxUsdExclusive === "50000") {
      return "Approval routing for $40,000–$49,999.99 is pending business confirmation. An administrator must configure an approver before this request can be forwarded.";
    }
    return `No approver is assigned to the "${matching[0].label}" approval threshold. Ask an administrator to configure the approval matrix.`;
  }
  return null;
}
