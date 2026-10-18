import type { Db } from '../../db/prisma';
import type { Config } from '../../config/index';
import type { CfClient } from '@duel/cf-client';
import { CfUserNotFoundError } from '@duel/cf-client';
import { CF_PROBLEM_URL } from '@duel/shared';
import { AppError } from '../../lib/errors';
import type {
  LinkStartInput,
  LinkStartResponse,
  LinkVerifyResponse,
  MyHandleResponse,
} from '@duel/shared';

export interface SolvedSyncTrigger {
  triggerSync: (userId: string, handle: string) => Promise<void>;
}

export class HandlesService {
  constructor(
    private readonly db: Db,
    private readonly cfClient: CfClient,
    private readonly config: Config,
    private readonly solvedSync?: SolvedSyncTrigger,
  ) {}

  public async linkStart(userId: string, input: LinkStartInput): Promise<LinkStartResponse> {
    const handleRaw = input.handle.trim();
    const handleNorm = handleRaw.toLowerCase();

    // 1. Confirm user does not already have a linked handle
    const existingUserHandle = await this.db.cfHandle.findUnique({
      where: { userId },
    });
    if (existingUserHandle) {
      throw new AppError(
        'HANDLE_ALREADY_LINKED',
        'Your account is already linked to a Codeforces handle',
      );
    }

    // 2. Confirm handle is not taken by another user
    const handleTaken = await this.db.cfHandle.findUnique({
      where: { handleNorm },
    });
    if (handleTaken) {
      throw new AppError(
        'HANDLE_TAKEN',
        'This Codeforces handle is already linked to another account',
      );
    }

    // 3. Confirm handle exists on Codeforces via user.info
    try {
      const cfUsers = await this.cfClient.userInfo([handleRaw], 'high');
      if (cfUsers.length === 0) {
        throw new AppError('CF_NOT_FOUND', `Codeforces handle "${handleRaw}" not found`);
      }
    } catch (err) {
      if (err instanceof CfUserNotFoundError) {
        throw new AppError('CF_NOT_FOUND', `Codeforces handle "${handleRaw}" not found`);
      }
      throw err;
    }

    // 4. Pick random problem from configured pool
    const problemKey = this.pickRandomProblem();
    const { contestId, index } = this.parseProblemKey(problemKey);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.handles.verifyWindowMs);

    // 5. Expire any existing pending verifications for this user
    await this.db.handleVerification.updateMany({
      where: { userId, status: 'PENDING' },
      data: { status: 'EXPIRED' },
    });

    // 6. Create new verification
    const verification = await this.db.handleVerification.create({
      data: {
        userId,
        handle: handleRaw,
        handleNorm,
        problemContestId: contestId,
        problemIndex: index,
        startedAt: now,
        expiresAt,
        status: 'PENDING',
      },
    });

    const problemUrl = CF_PROBLEM_URL(contestId, index);

    return {
      verificationId: verification.id,
      handle: handleRaw,
      problem: {
        contestId,
        index,
        url: problemUrl,
      },
      instructions: `Please submit a deliberately non-compiling solution to problem ${contestId}${index} on Codeforces within 5 minutes.`,
      startedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
  }

  public async linkVerify(userId: string): Promise<LinkVerifyResponse> {
    // 1. Find active pending verification
    const verification = await this.db.handleVerification.findFirst({
      where: { userId, status: 'PENDING' },
      orderBy: { startedAt: 'desc' },
    });

    if (!verification) {
      throw new AppError(
        'VERIFICATION_NOT_FOUND',
        'No pending verification found. Please start linking first.',
      );
    }

    const now = new Date();
    if (verification.expiresAt < now) {
      await this.db.handleVerification.update({
        where: { id: verification.id },
        data: { status: 'EXPIRED' },
      });
      throw new AppError(
        'VERIFICATION_EXPIRED',
        'Verification window has expired. Please start over.',
      );
    }

    // 2. Check user's recent submissions on Codeforces
    const subs = await this.cfClient.userStatus(
      verification.handle,
      1,
      this.config.handles.verifyStatusCount,
      'high',
    );

    const slackMs = this.config.handles.verifySlackMs;
    const thresholdSec = Math.floor((verification.startedAt.getTime() - slackMs) / 1000);

    const match = subs.find(
      (s) =>
        s.problem.contestId === verification.problemContestId &&
        s.problem.index.toUpperCase() === verification.problemIndex.toUpperCase() &&
        s.verdict === 'COMPILATION_ERROR' &&
        s.creationTimeSeconds >= thresholdSec,
    );

    if (!match) {
      throw new AppError(
        'VERIFICATION_FAILED',
        `No COMPILATION_ERROR submission found for problem ${verification.problemContestId}${verification.problemIndex} since verification started. Please submit on Codeforces and try again.`,
      );
    }

    // 3. Fetch latest Codeforces rating to seed initial rating
    let cfRating: number | null;
    try {
      const userInfo = await this.cfClient.userInfo([verification.handle], 'high');
      cfRating = userInfo[0]?.rating ?? null;
    } catch {
      cfRating = null;
    }

    const initialRating = Math.max(
      this.config.ratingInit.min,
      Math.min(this.config.ratingInit.max, cfRating ?? this.config.ratingInit.fallback),
    );

    // 4. Atomically persist CfHandle and PlayerRating
    await this.db.$transaction([
      this.db.handleVerification.update({
        where: { id: verification.id },
        data: { status: 'VERIFIED' },
      }),
      this.db.cfHandle.create({
        data: {
          userId,
          handle: verification.handle,
          handleNorm: verification.handleNorm,
          cfRatingAtLink: cfRating,
          verifiedAt: new Date(),
        },
      }),
      this.db.playerRating.create({
        data: {
          userId,
          rating: initialRating,
          peakRating: initialRating,
          matchesPlayed: 0,
          wins: 0,
          losses: 0,
          draws: 0,
        },
      }),
    ]);

    // 5. Kick off solved-set sync in background
    if (this.solvedSync) {
      this.solvedSync.triggerSync(userId, verification.handle).catch(() => {});
    }

    return {
      ok: true,
      handle: verification.handle,
      rating: initialRating,
    };
  }

  public async getMyHandle(userId: string): Promise<MyHandleResponse> {
    const handle = await this.db.cfHandle.findUnique({
      where: { userId },
      include: {
        user: {
          include: { rating: true },
        },
      },
    });

    const pending = await this.db.handleVerification.findFirst({
      where: {
        userId,
        status: 'PENDING',
        expiresAt: { gt: new Date() },
      },
      orderBy: { startedAt: 'desc' },
    });

    return {
      handle: handle
        ? {
            handle: handle.handle,
            verifiedAt: handle.verifiedAt.toISOString(),
            rating: handle.user.rating?.rating ?? this.config.ratingInit.fallback,
            matchesPlayed: handle.user.rating?.matchesPlayed ?? 0,
            peakRating: handle.user.rating?.peakRating ?? this.config.ratingInit.fallback,
          }
        : null,
      pendingVerification: pending
        ? {
            id: pending.id,
            handle: pending.handle,
            problemContestId: pending.problemContestId,
            problemIndex: pending.problemIndex,
            problemUrl: CF_PROBLEM_URL(pending.problemContestId, pending.problemIndex),
            startedAt: pending.startedAt.toISOString(),
            expiresAt: pending.expiresAt.toISOString(),
          }
        : null,
    };
  }

  private pickRandomProblem(): string {
    const list = this.config.handles.verifyProblems;
    if (list.length === 0) return '4A';
    const idx = Math.floor(Math.random() * list.length);
    return list[idx]!;
  }

  private parseProblemKey(key: string): { contestId: number; index: string } {
    const match = key.match(/^(\d+)([A-Za-z0-9]+)$/);
    if (!match) {
      return { contestId: 4, index: 'A' };
    }
    return {
      contestId: parseInt(match[1]!, 10),
      index: match[2]!.toUpperCase(),
    };
  }
}
