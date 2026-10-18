export interface PendingSubmissionInfo {
  firstSeenAtMs: number;
  lastCheckedAtMs: number;
}

export interface ActiveMatchQuestion {
  matchId: string;
  questionIdx: number;
  userId: string;
  handleNorm: string;
  contestId: number;
  index: string;
  baselineId: bigint;
  startedAtMs: number;
  deadlineAtMs: number;
  pending: Map<bigint, PendingSubmissionInfo>;
  processedSubmissions: Set<bigint>;
}

export interface PollerVerdictEvent {
  matchId: string;
  questionIdx: number;
  userId: string;
  handleNorm: string;
  submissionId: bigint;
  contestId: number;
  index: string;
  verdict: string;
  passedTestCount: number;
  timeConsumedMillis: number;
  memoryConsumedBytes: number;
  creationTimeSeconds: number;
  detectedAtMs: number;
}

export interface PollerPendingEvent {
  matchId: string;
  questionIdx: number;
  userId: string;
  handleNorm: string;
  submissionId: bigint;
  contestId: number;
  index: string;
  creationTimeSeconds: number;
  detectedAtMs: number;
}

export interface PollerListener {
  onVerdict?: (event: PollerVerdictEvent) => Promise<void> | void;
  onPending?: (event: PollerPendingEvent) => Promise<void> | void;
}

/** Non-final verdicts that indicate Codeforces is still evaluating the submission. */
export const NON_FINAL_VERDICTS = new Set<string>(['TESTING', 'SUBMITTED', 'WAITING']);

export function isFinalVerdict(verdict: string | undefined): boolean {
  if (!verdict) return false;
  return !NON_FINAL_VERDICTS.has(verdict.toUpperCase());
}
