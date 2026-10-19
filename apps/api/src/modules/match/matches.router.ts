import express, { type Request, type Response, type Router } from 'express';
import type { MatchEngine } from './match-engine';
import { toMatchStateSnapshot } from './match-engine.types';
import { requireUser } from '../auth/auth.middleware';
import type { Db } from '../../db/prisma';
import {
  CF_PROBLEM_URL,
  type MatchRecapDto,
  type MatchRecapPlayerDto,
  type MatchRecapQuestionDto,
} from '@duel/shared';
import { AppError } from '../../lib/errors';

export function createMatchesRouter(matchEngine: MatchEngine, db?: Db): Router {
  const router = express.Router();

  router.get('/active-match', requireUser, async (req: Request, res: Response, next) => {
    try {
      const match = await matchEngine.getActiveMatchForUser(req.user!.sub);
      res.status(200).json({ match: match ? toMatchStateSnapshot(match) : null });
    } catch (err) {
      next(err);
    }
  });

  router.get('/me/active', requireUser, async (req: Request, res: Response, next) => {
    try {
      const match = await matchEngine.getActiveMatchForUser(req.user!.sub);
      res.status(200).json({ match: match ? toMatchStateSnapshot(match) : null });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', async (req: Request, res: Response, next) => {
    try {
      if (!db) {
        throw new AppError('INTERNAL', 'Database client not available');
      }

      const matchId = typeof req.params.id === 'string' ? req.params.id : '';
      if (!matchId) {
        throw new AppError('BAD_REQUEST', 'Match ID is required');
      }

      const match = await db.match.findUnique({
        where: { id: matchId },
        include: {
          sheet: true,
          players: {
            include: {
              user: {
                include: { handle: true },
              },
            },
          },
          questions: {
            include: {
              problem: true,
              results: true,
            },
            orderBy: { idx: 'asc' },
          },
        },
      });

      if (!match) {
        throw new AppError('NOT_FOUND', `Match not found: ${matchId}`);
      }

      const isActive =
        match.status === 'LOBBY' || match.status === 'COUNTDOWN' || match.status === 'ACTIVE';

      if (isActive) {
        const viewerId = req.user?.sub;
        const isParticipant = match.players.some((p) => p.userId === viewerId);
        if (!isParticipant) {
          throw new AppError('FORBIDDEN', 'Access to active match is restricted to participants');
        }
      }

      const players: MatchRecapPlayerDto[] = match.players.map((p) => ({
        userId: p.userId,
        handle: p.user?.handle?.handle ?? p.handleNorm,
        score: p.totalScore,
        result: p.result,
        ratingBefore: p.ratingBefore,
        ratingAfter: p.ratingAfter,
        delta: p.ratingAfter !== null ? p.ratingAfter - p.ratingBefore : null,
      }));

      const questions: MatchRecapQuestionDto[] = match.questions.map((q) => {
        const scores: Record<string, number> = {};
        let firstSolveUserId: string | undefined;

        for (const r of q.results) {
          scores[r.userId] = r.points;
          if (r.firstSolve) {
            firstSolveUserId = r.userId;
          }
        }

        return {
          idx: q.idx,
          problem: {
            id: q.problem.id,
            contestId: q.problem.contestId,
            index: q.problem.index,
            name: q.problem.name,
            rating: q.problem.rating,
            tags: q.problem.tags,
            url: CF_PROBLEM_URL(q.problem.contestId, q.problem.index),
          },
          scores,
          firstSolveUserId,
          startedAt: q.startedAt?.toISOString(),
          endedAt: q.endedAt?.toISOString(),
        };
      });

      const recap: MatchRecapDto = {
        matchId: match.id,
        status: match.status,
        mode: match.mode,
        roomCode: match.roomCode,
        sheet: {
          id: match.sheet.id,
          slug: match.sheet.slug,
          name: match.sheet.name,
        },
        questionCount: match.questionCount,
        createdAt: match.createdAt.toISOString(),
        startedAt: match.startedAt?.toISOString() ?? null,
        finishedAt: match.finishedAt?.toISOString() ?? null,
        winnerUserId: match.winnerUserId,
        endReason: match.endReason,
        players,
        questions,
      };

      res.status(200).json(recap);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
