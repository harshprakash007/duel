import express, { type Request, type Response, type Router } from 'express';
import { LeaderboardQuerySchema } from '@duel/shared';
import type { LeaderboardService } from './leaderboard.service';

export function createLeaderboardRouter(leaderboardService: LeaderboardService): Router {
  const router = express.Router();

  router.get('/', async (req: Request, res: Response, next) => {
    try {
      const query = LeaderboardQuerySchema.parse(req.query);
      const viewerUserId = req.user?.sub;
      const result = await leaderboardService.getLeaderboard(query, viewerUserId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
