import type { Db } from '../../db/prisma';
import type { Config } from '../../config/index';
import type { LevelSheet, Problem } from '../../generated/prisma/client';
import { AppError } from '../../lib/errors';
import type { PickerParams } from '@duel/shared';

export interface CandidateProblem {
  id: number;
  contestId: number;
  index: string;
  name: string;
  rating: number;
  tags: string[];
}

/**
 * Pure selection algorithm: selects n problems distributed across [minRating, maxRating]
 * with target rating snapping, window widening, and random choice.
 */
export function selectProblems(
  candidates: CandidateProblem[],
  n: number,
  minRating: number,
  maxRating: number,
  params: PickerParams,
): CandidateProblem[] {
  if (candidates.length < n) {
    throw new AppError(
      'INVALID_STATE',
      `Insufficient candidate problems: needed ${n}, found ${candidates.length}`,
    );
  }

  const remaining = [...candidates];
  const picked: CandidateProblem[] = [];

  for (let i = 0; i < n; i++) {
    const rawTarget = n === 1 ? minRating : minRating + ((maxRating - minRating) * i) / (n - 1);
    const target = Math.round(rawTarget / params.snap) * params.snap;

    let currentWindow = params.window;
    let pool: CandidateProblem[] = [];

    // Search with progressive widening
    const maxAllowedWindow = Math.max(maxRating - minRating, 1000);
    while (pool.length === 0 && currentWindow <= maxAllowedWindow) {
      pool = remaining.filter(
        (p) => p.rating >= target - currentWindow && p.rating <= target + currentWindow,
      );
      if (pool.length === 0) {
        currentWindow += params.windowStep;
      }
    }

    // If still empty after widening, fallback to any remaining candidate
    if (pool.length === 0) {
      pool = remaining;
    }

    if (pool.length === 0) {
      throw new AppError('INVALID_STATE', 'Failed to pick problems: pool exhausted');
    }

    const selectedIdx = Math.floor(Math.random() * pool.length);
    const chosen = pool[selectedIdx]!;

    picked.push(chosen);
    const removeIdx = remaining.findIndex((p) => p.id === chosen.id);
    if (removeIdx !== -1) {
      remaining.splice(removeIdx, 1);
    }
  }

  return picked;
}

export class PickerService {
  constructor(
    private readonly db: Db,
    private readonly config: Config,
  ) {}

  public async pick(
    sheet: LevelSheet,
    playerAId: string,
    playerBId: string,
    n = sheet.questionCount,
  ): Promise<Problem[]> {
    // 1. Check for curated problems on this sheet
    const curated = await this.db.levelSheetProblem.findMany({
      where: { sheetId: sheet.id },
      include: { problem: true },
    });

    let baseCandidates: CandidateProblem[];

    if (curated.length > 0) {
      baseCandidates = curated
        .filter((c) => c.problem.isActive)
        .map((c) => ({
          id: c.problem.id,
          contestId: c.problem.contestId,
          index: c.problem.index,
          name: c.problem.name,
          rating: c.problem.rating,
          tags: c.problem.tags,
        }));
    } else {
      // Filter by rating band and solvedCount
      const problems = await this.db.problem.findMany({
        where: {
          isActive: true,
          rating: {
            gte: sheet.minRating,
            lte: sheet.maxRating,
          },
          solvedCount: {
            gte: sheet.minSolvedCount,
          },
        },
      });

      // Filter tags
      const includeSet =
        sheet.includeTags.length > 0
          ? new Set(sheet.includeTags.map((t) => t.toLowerCase()))
          : null;
      const excludeSet = new Set(sheet.excludeTags.map((t) => t.toLowerCase()));

      baseCandidates = problems
        .filter((p) => {
          if (excludeSet.size > 0 && p.tags.some((t) => excludeSet.has(t.toLowerCase()))) {
            return false;
          }
          if (includeSet && !p.tags.some((t) => includeSet.has(t.toLowerCase()))) {
            return false;
          }
          return true;
        })
        .map((p) => ({
          id: p.id,
          contestId: p.contestId,
          index: p.index,
          name: p.name,
          rating: p.rating,
          tags: p.tags,
        }));
    }

    // 2. Exclude problems solved by either player
    const solved = await this.db.userSolved.findMany({
      where: {
        userId: { in: [playerAId, playerBId] },
      },
      select: { contestId: true, index: true },
    });
    const solvedSet = new Set(solved.map((s) => `${s.contestId}-${s.index.toUpperCase()}`));

    // 3. Exclude problems seen in either player's last 50 matches
    const recentMatchesLimit = this.config.picker.recentMatchesExcluded;
    const playerMatches = await this.db.matchPlayer.findMany({
      where: { userId: { in: [playerAId, playerBId] } },
      orderBy: { match: { createdAt: 'desc' } },
      take: recentMatchesLimit * 2,
      select: { matchId: true },
    });

    const matchIds = [...new Set(playerMatches.map((m) => m.matchId))];
    const recentQuestions =
      matchIds.length > 0
        ? await this.db.matchQuestion.findMany({
            where: { matchId: { in: matchIds } },
            select: { problemId: true },
          })
        : [];
    const recentProblemIdSet = new Set(recentQuestions.map((q) => q.problemId));

    // Filter candidates
    const eligible = baseCandidates.filter(
      (c) =>
        !solvedSet.has(`${c.contestId}-${c.index.toUpperCase()}`) && !recentProblemIdSet.has(c.id),
    );

    if (eligible.length < n) {
      throw new AppError(
        'INVALID_STATE',
        `ABORT_NO_PROBLEMS: only ${eligible.length} eligible problems available (needed ${n})`,
      );
    }

    const selected = selectProblems(
      eligible,
      n,
      sheet.minRating,
      sheet.maxRating,
      this.config.picker,
    );

    // Fetch full Problem records from DB
    const selectedIds = selected.map((s) => s.id);
    const fullProblems = await this.db.problem.findMany({
      where: { id: { in: selectedIds } },
    });

    // Preserve the picked difficulty order
    return selectedIds.map((id) => fullProblems.find((p) => p.id === id)!).filter(Boolean);
  }
}
