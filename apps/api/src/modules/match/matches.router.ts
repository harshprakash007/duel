import express, { type Request, type Response, type Router } from 'express';
import type { MatchEngine } from './match-engine';
import { toMatchStateSnapshot } from './match-engine.types';
import { requireUser } from '../auth/auth.middleware';

export function createMatchesRouter(matchEngine: MatchEngine): Router {
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

  return router;
}
