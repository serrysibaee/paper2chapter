import type { VerificationResult } from "@/lib/types";

const LABELS: Record<VerificationResult["status"], string> = {
  verified: "✓ verified",
  failed: "✗ check failed",
  error: "not checkable",
  skipped: "not run",
};

export function VerifyBadge({ result }: { result?: VerificationResult }) {
  if (!result) return null;
  return (
    <span className={`badge ${result.status}`} title={`${result.method}: ${result.detail}`}>
      {LABELS[result.status]}
    </span>
  );
}
